jest.mock('fs/promises', () => ({ readFile: jest.fn() }));

import { readFile } from 'fs/promises';

import { extractFb2Cover } from './cover-fb2';

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;

describe('extractFb2Cover', () => {
  beforeEach(() => jest.resetAllMocks());

  it('extracts and decodes cover binary referenced by coverpage image href', async () => {
    const xml = `
      <FictionBook>
        <description>
          <title-info>
            <coverpage><image l:href="#img1" /></coverpage>
          </title-info>
        </description>
        <binary id="img1">AQIDBA==</binary>
      </FictionBook>
    `;
    mockReadFile.mockResolvedValue(xml as unknown as Awaited<ReturnType<typeof readFile>>);

    await expect(extractFb2Cover('/book.fb2')).resolves.toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it('returns null when coverpage or referenced binary is missing', async () => {
    mockReadFile.mockResolvedValue('<FictionBook><description><title-info /></description></FictionBook>' as any);
    await expect(extractFb2Cover('/book.fb2')).resolves.toBeNull();
  });

  it('returns null on malformed XML', async () => {
    mockReadFile.mockResolvedValue('<not xml' as any);
    await expect(extractFb2Cover('/book.fb2')).resolves.toBeNull();
  });
});
