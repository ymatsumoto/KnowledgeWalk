import * as vscode from 'vscode';

let channel: vscode.LogOutputChannel | undefined;

export function initLog(context: vscode.ExtensionContext): vscode.LogOutputChannel {
  channel = vscode.window.createOutputChannel('mdExplorer', { log: true });
  context.subscriptions.push(channel);
  return channel;
}

export function showLog(): void {
  channel?.show(true);
}

/**
 * Diagnostics for the preview. Nothing here is on a hot path, and the channel is a
 * LogOutputChannel, so the verbosity is the reader's to choose from the Output panel.
 */
export const log = {
  info(message: string, ...args: unknown[]): void {
    channel?.info(message, ...args);
  },
  warn(message: string, ...args: unknown[]): void {
    channel?.warn(message, ...args);
  },
  error(message: string, ...args: unknown[]): void {
    channel?.error(message, ...args);
  },
  debug(message: string, ...args: unknown[]): void {
    channel?.debug(message, ...args);
  },
};
