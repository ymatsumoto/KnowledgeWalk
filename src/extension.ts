import * as vscode from 'vscode';
import type { PreviewState } from './protocol';
import type { MdExplorerApi } from './api';
import { PreviewManager } from './previewManager';
import { PreviewPanel, renderErrorCount } from './previewPanel';
import { RedirectEditorProvider } from './redirectEditorProvider';
import { registerCommands } from './commands';
import { registerWatchers } from './watcher';
import { EditModeTracker } from './editModeTracker';
import { registerReclaim } from './reclaim';
import { WikiLinkIndex } from './wikiIndex';
import { OkfService } from './okf/service';
import { resetRenderer } from './renderer/markdown';
import { initLog, log } from './log';

export function activate(context: vscode.ExtensionContext): MdExplorerApi {
  initLog(context);
  log.info('mdExplorer activated');

  // Tells the built-in Markdown extension that something else owns the preview, which is
  // how it knows to withdraw its own "Open Preview" menu entries and title-bar buttons
  // instead of showing a second, near-identical set alongside ours.
  void vscode.commands.executeCommand('setContext', 'hasCustomMarkdownPreview', true);

  const editing = new EditModeTracker(context);
  const wikiIndex = new WikiLinkIndex();
  const okf = new OkfService(wikiIndex);
  const manager = new PreviewManager(context.extensionUri, editing, wikiIndex, okf);

  context.subscriptions.push(
    manager,
    okf,
    okf.onDidChangeDisplay(() => manager.refreshAll()),
    wikiIndex,

    vscode.window.registerCustomEditorProvider(
      RedirectEditorProvider.viewType,
      new RedirectEditorProvider(manager),
      {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: { retainContextWhenHidden: false },
      }
    ),

    vscode.window.registerWebviewPanelSerializer(PreviewPanel.viewType, {
      deserializeWebviewPanel: async (panel, state) => {
        manager.restore(panel, state as PreviewState | undefined);
      },
    }),

    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('mdExplorer')) {
        resetRenderer();
        manager.refreshAll();
      }
    })
  );

  registerCommands(context, manager, editing);
  registerWatchers(context, manager);
  registerReclaim(context, manager, editing);

  // The Markdown pipeline is loaded on demand so activation stays cheap, but the first
  // preview should not pay for it either. Warm it once the window has settled.
  const warmup = setTimeout(() => void import('./renderer/markdown'), 2000);
  context.subscriptions.push(new vscode.Disposable(() => clearTimeout(warmup)));

  return {
    get previews() {
      return manager.all.map((preview) => preview.snapshot());
    },
    get activePreview() {
      return manager.active?.snapshot();
    },
    get renderErrors() {
      return renderErrorCount();
    },
    openPreview: (uri, column) => {
      manager.open(uri, column ?? vscode.ViewColumn.Active);
    },
    followLink: (href, linkId, newTab) => manager.active?.followLink(href, linkId, newTab),
    clickRenderedLink: (linkId, newTab) => manager.active?.clickRenderedLink(linkId, newTab) ?? false,
    renderedHtml: () => manager.active?.renderedHtml(),
    peek: async (target) => manager.active?.peek(target),
    editGesture: (line) => manager.active?.editGesture(line),
    goBack: () => manager.active?.goBack(),
    goForward: () => manager.active?.goForward(),
  };
}

export function deactivate(): void {
  // Everything is owned by context.subscriptions.
}
