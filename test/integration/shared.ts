import * as vscode from 'vscode';
import * as path from 'path';
import { waitFor } from './harness';

export const SAMPLES = path.join(__dirname, '..', '..', 'samples');

export const sample = (...parts: string[]) => vscode.Uri.file(path.join(SAMPLES, ...parts));

export function allTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all.flatMap((group) => group.tabs);
}

export function activeTab(): vscode.Tab | undefined {
  return vscode.window.tabGroups.activeTabGroup.activeTab;
}

export function describeTab(tab: vscode.Tab | undefined): string {
  if (!tab) {
    return '<no tab>';
  }
  const input = tab.input as any;
  return `${tab.label} [${input?.constructor?.name}${input?.viewType ? ` ${input.viewType}` : ''}]`;
}

export function describeTabs(): string {
  return allTabs().map(describeTab).join(', ') || '<none>';
}

export async function closeEverything(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await waitFor('all editors to close', () => allTabs().length === 0);
}

/** Open a file the way a user does — through the editor resolver, not our own command. */
export async function openThroughResolver(uri: vscode.Uri): Promise<void> {
  await vscode.commands.executeCommand('vscode.open', uri);
}

/** Navigation is debounced by 150ms so one keypress cannot skip two entries. */
export const settleNavDebounce = () => new Promise((resolve) => setTimeout(resolve, 200));
