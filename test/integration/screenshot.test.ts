// Not part of the suite: drives the preview for screenshots when MDX_SHOTS is set.
import * as fs from 'fs';
import * as path from 'path';
import { getApi, test, waitFor } from './harness';
import { closeEverything, openThroughResolver, sample } from './shared';

const dir = process.env.MDX_SHOTS;
if (dir) {
  test('SCREENSHOTS', async () => {
    const files = (process.env.MDX_SHOT_FILES ?? '').split(',').filter(Boolean);
    for (const [i, file] of files.entries()) {
      await closeEverything();
      await openThroughResolver(sample(...file.split('/')));
      await waitFor('preview', () => getApi().activePreview?.uri.endsWith(file) && getApi().activePreview?.isReady, 15000);
      await new Promise((r) => setTimeout(r, 2500));
      fs.writeFileSync(path.join(dir, `ready-${i}`), file);
      await waitFor('capture', () => fs.existsSync(path.join(dir, `done-${i}`)), 30000);
    }
  });
}
