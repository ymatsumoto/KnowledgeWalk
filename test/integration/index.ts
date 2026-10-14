import * as vscode from 'vscode';
import type { MdExplorerApi } from '../../src/api';
import { runCases, setApi } from './harness';
import './perf.test';
import './editorAssociation.test';
import './navigation.test';
import './editMode.test';
import './scroll.test';
import './sync.test';
import './okf.test';
import './stress.test';

/** Entry point VS Code calls inside the extension host. */
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension<MdExplorerApi>('local.mdexplorer');
  if (!extension) {
    throw new Error('local.mdexplorer is not installed in the test instance');
  }
  setApi(await extension.activate());
  await runCases();
}
