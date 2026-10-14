import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { KnowledgeWalkApi } from '../../src/api';
import { runCases, setApi } from './harness';
import './perf.test';
import './editorAssociation.test';
import './navigation.test';
import './editMode.test';
import './scroll.test';
import './sync.test';
import './okf.test';
import './stress.test';
import './schema.test';

/** Entry point VS Code calls inside the extension host. */
export async function run(): Promise<void> {
  // The id comes from package.json, so a change of publisher or name cannot leave the
  // suite looking for an extension that no longer exists.
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')
  ) as { publisher: string; name: string };
  const id = `${manifest.publisher}.${manifest.name}`;
  const extension = vscode.extensions.getExtension<KnowledgeWalkApi>(id);
  if (!extension) {
    throw new Error(`${id} is not installed in the test instance`);
  }
  setApi(await extension.activate());
  await runCases();
}
