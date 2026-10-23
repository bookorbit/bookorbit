import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { inspectEpubMediaOverlayFields, mediaOverlayCapabilityFromFields } from './epub-media-overlay-capability';

describe('media-overlay inspection failure', () => {
  it('leaves failed detection unchecked instead of recording a verified negative', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'overlay-inspection-'));
    try {
      const path = join(directory, 'broken.epub');
      await writeFile(path, 'Not an EPUB archive');
      const onError = vi.fn();
      const fields = await inspectEpubMediaOverlayFields(path, 'epub', onError);
      expect(onError).toHaveBeenCalledOnce();
      expect(fields).toEqual({ mediaOverlayAvailable: false, mediaOverlayDurationSeconds: null, mediaOverlayCheckedAt: null });
      expect(mediaOverlayCapabilityFromFields({ format: 'epub', ...fields })).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
