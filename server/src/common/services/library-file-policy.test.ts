import { ConflictException, ForbiddenException } from '@nestjs/common';
import { LibraryFilePolicy } from './library-file-policy';

describe('LibraryFilePolicy', () => {
  it('keeps folder registration and path-based writes mutually exclusive', () => {
    const policy = new LibraryFilePolicy();
    {
      using lookup = policy.beginPathLookup();
      expect(() => policy.beginRootChange()).toThrow(ConflictException);
    }
    using roots = policy.beginRootChange();
    expect(() => policy.beginPathLookup()).toThrow(ConflictException);
    expect(() => policy.beginRootChange()).toThrow(ConflictException);
  });

  it('keeps folder removal and writes to the same library mutually exclusive', () => {
    const policy = new LibraryFilePolicy();
    {
      using writing = policy.beginWrite(1, false);
      expect(() => policy.beginRootChange(1)).toThrow(ConflictException);
      using unrelated = policy.beginRootChange(2);
    }
    using editing = policy.beginRootChange(1);
    expect(() => policy.beginWrite(1, false)).toThrow(ConflictException);
    using unrelated = policy.beginWrite(2, false);
  });

  it('holds the old mode until every in-flight writer has released the library', async () => {
    const policy = new LibraryFilePolicy();
    const save = vi.fn().mockResolvedValue(undefined);
    {
      using _first = policy.beginWrite(1, false);
      {
        using _second = policy.beginWrite(1, false);
        await expect(policy.change(1, true, save)).rejects.toThrow(ConflictException);
      }
      await expect(policy.change(1, true, save)).rejects.toThrow(ConflictException);
      expect(save).not.toHaveBeenCalled();
    }
    await policy.change(1, true, save);
    expect(() => policy.beginWrite(1, false)).toThrow(ForbiddenException);
    using _other = policy.beginWrite(2, false);
  });

  it('excludes writers while saving and restores the prior mode on failure', async () => {
    const policy = new LibraryFilePolicy();
    await expect(
      policy.change(1, true, () => {
        expect(() => policy.beginWrite(1, false)).toThrow(ForbiddenException);
        expect(() => policy.keepFilesOnDelete(1, false)).toThrow(ConflictException);
        return Promise.reject(new Error('save failed'));
      }),
    ).rejects.toThrow('save failed');
    using _write = policy.beginWrite(1, false);
  });
});
