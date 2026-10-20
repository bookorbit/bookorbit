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

  it('serves a bookmark with a note as the note the device makes of a dogear', () => {
    const served = toKoboReadingServiceDogear({
      externalKey: 'dogear-1',
      clientLastModifiedUtc: '2026-10-18T06:44:08Z',
      location,
      note: 'Asb08',
    });

    expect(served).toEqual({
      attachments: {},
      clientLastModifiedUtc: '2026-10-18T06:44:08Z',
      context: null,
      highlightColor: '#F6F3B3',
      highlightedText: '',
      id: 'dogear-1',
      location,
      noteText: 'Asb08',
      type: 'note',
    });
  });

  it('serves a blank bookmark note as a plain dogear', () => {
    expect(
      toKoboReadingServiceDogear({ externalKey: 'dogear-1', clientLastModifiedUtc: '2026-10-18T06:44:08Z', location, note: '  ' }),
    ).toMatchObject({
      type: 'dogear',
    });
  });
});
