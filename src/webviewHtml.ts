import * as vscode from 'vscode';
import * as fs from 'fs';
import type { WebviewConfig } from './protocol';

/**
 * Our own stylesheets are small and are inlined into the shell: each separate webview
 * resource is a round trip through the webview's service worker, and the shell's load
 * time is the dominant cost of opening a preview.
 */
const styleCache = new Map<string, string>();

function inlineStyle(extensionUri: vscode.Uri, name: string): string {
  const file = vscode.Uri.joinPath(extensionUri, 'media', name).fsPath;
  let css = styleCache.get(file);
  if (css === undefined) {
    css = fs.readFileSync(file, 'utf8');
    styleCache.set(file, css);
  }
  return css;
}

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

export function buildPreviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  config: WebviewConfig
): string {
  const asset = (...parts: string[]) =>
    webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, ...parts)).toString();

  const n = nonce();
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} https: data:`,
    `font-src ${webview.cspSource}`,
    // Mermaid injects <style> elements at runtime, and KaTeX emits inline styles.
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${n}'`,
  ].join('; ');

  const bootstrap = {
    config,
    mermaidUri: asset('dist', 'mermaid.js'),
    // 23 KB of stylesheet plus web fonts, pulled in only by documents that contain math.
    katexCssUri: asset('media', 'katex', 'katex.min.css'),
    nonce: n,
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>${inlineStyle(extensionUri, 'preview.css')}
${inlineStyle(extensionUri, 'highlight.css')}</style>
</head>
<body data-vscode-context='{"webviewSection":"body","preventDefaultContextMenuItems":false}'>
<main id="mdx-content" class="mdx-body"></main>
<script nonce="${n}">window.MDX_BOOTSTRAP = ${JSON.stringify(bootstrap)};</script>
<script nonce="${n}" src="${asset('dist', 'webview.js')}"></script>
</body>
</html>`;
}
