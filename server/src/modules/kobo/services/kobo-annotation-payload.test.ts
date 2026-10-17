import { describe, expect, it } from 'vitest';

import { extractKoboAnnotationOperations, toKoboReadingServiceDogear } from './kobo-annotation-payload';

const location = {
  span: {
    chapterFilename: 'OEBPS/Text/018.xhtml',
    chapterProgress: 0.25,
    chapterTitle: 'Chapter Eleven',
    startPath: 'OEBPS/Text/018.xhtml#kobo.23.1',
    endPath: 'OEBPS/Text/018.xhtml#kobo.23.1',
    startChar: 0,
    endChar: 0,
  },
};

describe('kobo annotation payload', () => {
  it('reads a device dogear with its type and chapter', () => {
    const [operation] = extractKoboAnnotationOperations({
      updatedAnnotations: [
        { clientLastModifiedUtc: '2026-10-17T01:28:39Z', highlightedText: '', id: '13b9bf63-c3d8-4f56-98f8-468f744f1423', location, type: 'dogear' },
      ],
    });

    expect(operation).toMatchObject({ kind: 'upsert', type: 'dogear', text: '', chapterTitle: 'Chapter Eleven', location });
  });

  it('serves a bookmark back in the shape the device uploads a dogear, with no text or colour', () => {
    const served = toKoboReadingServiceDogear({ externalKey: 'dogear-1', clientLastModifiedUtc: '2026-10-17T01:28:39Z', location });

    expect(served).toEqual({
      attachments: {},
      clientLastModifiedUtc: '2026-10-17T01:28:39Z',
      context: null,
      highlightedText: '',
      id: 'dogear-1',
      location,
      type: 'dogear',
    });
    expect(served).not.toHaveProperty('highlightColor');
  });
});
