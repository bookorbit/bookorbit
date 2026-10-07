import { describeWriteFailure } from './write-failure-reason';

const FILE = '/library/Some Author/Missing File/Book.m4b';

describe('describeWriteFailure', () => {
  it('keeps the tool output of a failed command and drops the command line', () => {
    const error = Object.assign(
      new Error(
        `Command failed: ffmpeg -v error -y -i ${FILE} -metadata description=<p>A very long description</p> /library/Some Author/Missing File/.bookorbit-write-1.m4b`,
      ),
      {
        stderr: `[in#0 @ 0x97903c000] Error opening input: No such file or directory\nError opening input file ${FILE}.\nError opening input files: No such file or directory\n`,
      },
    );

    expect(describeWriteFailure(error, FILE)).toBe(
      'Error opening input: No such file or directory Error opening input file Book.m4b. Error opening input files: No such file or directory',
    );
  });

  it('reduces paths in filesystem errors to file names', () => {
    const error = Object.assign(new Error(`EACCES: permission denied, open '/library/Some Author/Missing File/.epub-write-abc'`), { code: 'EACCES' });

    expect(describeWriteFailure(error, '/library/Some Author/Missing File/Book.epub')).toBe("EACCES: permission denied, open '.epub-write-abc'");
  });

  it('reduces a path outside the book folder to its last segment', () => {
    expect(describeWriteFailure(new Error('cannot read /srv/app-data/covers/12/audio/cover_custom.png'), FILE)).toBe('cannot read cover_custom.png');
  });

  it('caps the length', () => {
    expect(describeWriteFailure(new Error('x'.repeat(5_000)), FILE)).toHaveLength(300);
  });

  it('describes a failed command that printed nothing', () => {
    expect(describeWriteFailure(new Error(`Command failed: ffmpeg -i ${FILE}`), FILE)).toBe('external tool failed');
  });

  it('leaves an ordinary message alone', () => {
    expect(describeWriteFailure(new Error('zip broken'), FILE)).toBe('zip broken');
    expect(describeWriteFailure('1 of 2 file writes failed', FILE)).toBe('1 of 2 file writes failed');
  });
});
