import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { UploadValidatorService } from '../../upload/upload-validator.service';
import { normalizeUploadPath, planRequestUpload, uploadSet, type RequestUploadPlanContext } from './request-upload-plan';

const MB = 1024 * 1024;
const validator = new UploadValidatorService();
const ebook: RequestUploadPlanContext = {
  mediaKind: 'ebook',
  title: 'Mexican Gothic',
  maxFileSizeBytes: 4096 * MB,
  sanitizeName: (name) => validator.sanitizeFilename(name),
};
const audiobook: RequestUploadPlanContext = { ...ebook, mediaKind: 'audiobook', title: 'The Silent Patient' };

function tracks(count: number, folder = 'The Silent Patient') {
  return Array.from({ length: count }, (_, index) => ({ path: `${folder}/Track ${String(index + 1).padStart(2, '0')}.mp3`, sizeBytes: 15 * MB }));
}

describe('planRequestUpload', () => {
  it('reads one e-book file as one book ready to send', () => {
    const { plan } = planRequestUpload([{ path: 'Mexican Gothic.epub', sizeBytes: 1.4 * MB }], ebook);

    expect(plan.status).toBe('ready');
    expect(plan.rootName).toBeNull();
    expect(plan.selectedUnitIndex).toBe(0);
    expect(plan.units[0]).toMatchObject({ mediaKind: 'ebook', contentFileCount: 1, formats: ['epub'], matchesMedium: true, matchesTitle: true });
    expect(plan.files[0]).toMatchObject({ role: 'content', unitIndex: 0, skipReason: null, tooLarge: false });
  });

  it('keeps formats that share a name together as one book, best format first', () => {
    const { plan } = planRequestUpload(
      [
        { path: 'Mexican Gothic.pdf', sizeBytes: 3.6 * MB },
        { path: 'Mexican Gothic.azw3', sizeBytes: 2.1 * MB },
        { path: 'Mexican Gothic.epub', sizeBytes: 1.4 * MB },
      ],
      ebook,
    );

    expect(plan.status).toBe('ready');
    expect(plan.units).toHaveLength(1);
    expect(plan.units[0]!.formats).toEqual(['epub', 'azw3', 'pdf']);
    expect(uploadSet(plan.files, plan.status, plan.selectedUnitIndex)).toHaveLength(3);
  });

  it('reads a dropped audiobook folder with its cover, and leaves hidden files out', () => {
    const { plan, files } = planRequestUpload(
      [...tracks(38), { path: 'The Silent Patient/cover.jpg', sizeBytes: 412 * 1024 }, { path: 'The Silent Patient/.DS_Store', sizeBytes: 6 * 1024 }],
      audiobook,
    );

    expect(plan.status).toBe('ready');
    expect(plan.rootName).toBe('The Silent Patient');
    expect(plan.units[0]).toMatchObject({ mediaKind: 'audiobook', contentFileCount: 38, totalFileCount: 39, title: 'The Silent Patient' });
    expect(plan.files.find((file) => file.path.endsWith('cover.jpg'))).toMatchObject({ role: 'artwork', unitIndex: 0 });
    expect(plan.files.find((file) => file.path.endsWith('.DS_Store'))).toMatchObject({ role: 'skipped', skipReason: 'hidden' });
    expect(uploadSet(plan.files, plan.status, plan.selectedUnitIndex)).toHaveLength(39);
    // Stored relative to the picked folder, which becomes the staging folder's own name.
    expect(files[0]!.releasePath).toBe('Track 01.mp3');
  });

  it('keeps disc folders apart within one audiobook', () => {
    const { plan } = planRequestUpload([...tracks(2, 'Book/CD 1'), ...tracks(2, 'Book/CD 2')], audiobook);

    expect(plan.status).toBe('ready');
    expect(plan.units).toHaveLength(1);
    expect(plan.units[0]!.contentFileCount).toBe(4);
  });

  it('sends an archive whole, to be read once it arrives', () => {
    const { plan } = planRequestUpload([{ path: 'The Silent Patient [Unabridged].zip', sizeBytes: 641 * MB }], audiobook);

    expect(plan.status).toBe('archive');
    expect(plan.units).toEqual([]);
    expect(plan.files[0]).toMatchObject({ role: 'archive', format: 'zip' });
    expect(uploadSet(plan.files, plan.status, plan.selectedUnitIndex)).toHaveLength(1);
  });

  it('refuses two separate archives, which an import never opens', () => {
    const { plan } = planRequestUpload(
      [
        { path: 'part one.zip', sizeBytes: MB },
        { path: 'part two.zip', sizeBytes: MB },
      ],
      ebook,
    );

    expect(plan.status).toBe('several_archives');
  });

  it('asks for a choice between several books, suggesting the one whose title matches', () => {
    const { plan } = planRequestUpload(
      [
        { path: 'Gods of Jade and Shadow.epub', sizeBytes: 1.1 * MB },
        { path: 'Mexican Gothic.epub', sizeBytes: 1.4 * MB },
        { path: 'Velvet Was the Night.epub', sizeBytes: 1.3 * MB },
      ],
      ebook,
    );

    expect(plan.status).toBe('choose');
    expect(plan.units).toHaveLength(3);
    const suggested = plan.units[plan.selectedUnitIndex!]!;
    expect(suggested.title).toBe('Mexican Gothic');
    expect(suggested.matchesTitle).toBe(true);
    expect(uploadSet(plan.files, plan.status, plan.selectedUnitIndex)).toHaveLength(1);
  });

  it('leaves a book of another kind out when one of the requested kind is there', () => {
    const { plan } = planRequestUpload([{ path: 'Mexican Gothic.epub', sizeBytes: MB }, ...tracks(2, 'Mexican Gothic audio')], ebook);

    expect(plan.status).toBe('ready');
    expect(plan.files.filter((file) => file.skipReason === 'other_book')).toHaveLength(2);
  });

  it('says when nothing is the kind of book the request asks for', () => {
    const { plan } = planRequestUpload(tracks(3, 'Mexican Gothic'), ebook);

    expect(plan.status).toBe('wrong_medium');
    expect(plan.units[0]!.matchesMedium).toBe(false);
    // Left as they are, so the drawer can still say what they are.
    expect(plan.files.every((file) => file.role === 'content')).toBe(true);
  });

  it('says when there is no book at all', () => {
    const { plan } = planRequestUpload([{ path: 'notes.txt', sizeBytes: 100 }], ebook);

    expect(plan.status).toBe('no_book');
    expect(plan.files[0]).toMatchObject({ role: 'skipped', skipReason: 'unsupported' });
  });

  it('flags a file over the upload limit', () => {
    const { plan } = planRequestUpload([{ path: 'Mexican Gothic.epub', sizeBytes: 20 * MB }], { ...ebook, maxFileSizeBytes: 10 * MB });

    expect(plan.status).toBe('file_too_large');
    expect(plan.files[0]!.tooLarge).toBe(true);
  });

  it('leaves out empty files and files deeper than the import reads', () => {
    const { plan } = planRequestUpload(
      [
        { path: 'Mexican Gothic.epub', sizeBytes: MB },
        { path: 'empty.epub', sizeBytes: 0 },
        { path: 'a/b/c/d/e/deep.epub', sizeBytes: MB },
      ],
      ebook,
    );

    expect(plan.status).toBe('ready');
    expect(plan.files[1]).toMatchObject({ role: 'skipped', skipReason: 'empty' });
    expect(plan.files[2]).toMatchObject({ role: 'skipped', skipReason: 'junk_folder' });
  });

  it('refuses the same path twice', () => {
    expect(() =>
      planRequestUpload(
        [
          { path: 'Book.epub', sizeBytes: 1 },
          { path: './Book.epub', sizeBytes: 1 },
        ],
        ebook,
      ),
    ).toThrow(BadRequestException);
  });
});

describe('normalizeUploadPath', () => {
  const sanitize = (name: string) => validator.sanitizeFilename(name);

  it('cleans each segment the way an upload session cleans its filename', () => {
    expect(normalizeUploadPath('Folder\\Sub/Title: Part 1?.epub', sanitize)).toBe('Folder/Sub/Title_ Part 1_.epub');
  });

  it('keeps the dot that marks a hidden file', () => {
    expect(normalizeUploadPath('Book/.DS_Store', sanitize)).toBe('Book/.DS_Store');
  });

  it('refuses a path that climbs out of what was picked', () => {
    expect(() => normalizeUploadPath('Book/../../etc/passwd', sanitize)).toThrow(BadRequestException);
  });

  it('refuses a path with no name', () => {
    expect(() => normalizeUploadPath('//', sanitize)).toThrow(BadRequestException);
  });
});
