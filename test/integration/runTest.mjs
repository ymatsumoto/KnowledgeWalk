import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTests } from '@vscode/test-electron';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

try {
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, 'test', 'integration-dist', 'index.js'),
    launchArgs: [
      path.join(root, 'samples'),
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-workspace-trust',
      '--user-data-dir',
      path.join(root, '.vscode-test-profile'),
      '--disable-extensions',
    ],
  });
} catch (error) {
  console.error('Integration tests failed:', error?.message ?? error);
  process.exit(1);
}
