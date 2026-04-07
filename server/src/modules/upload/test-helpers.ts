import type { RequestUser } from '../../common/types/request-user';

export function makeRequestUser(overrides?: Partial<RequestUser>): RequestUser {
  return {
    id: 1,
    username: 'test-user',
    name: 'Test User',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [],
    ...overrides,
  };
}

export function makeLibraryRow(
  overrides?: Partial<{
    id: number;
    allowedFormats: string[];
    fileNamingPattern: string | null;
    organizationMode: string | null;
  }>,
) {
  return {
    id: 1,
    allowedFormats: [] as string[],
    fileNamingPattern: null as string | null,
    organizationMode: 'book_per_folder' as string | null,
    ...overrides,
  };
}

export function makeFolderRow(overrides?: Partial<{ id: number; libraryId: number; path: string }>) {
  return {
    id: 1,
    libraryId: 1,
    path: '/library',
    ...overrides,
  };
}

export function selectChain(rows: unknown[]) {
  const whereResult = Promise.resolve(rows) as any;
  whereResult.limit = vi.fn().mockResolvedValue(rows);

  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue(whereResult),
    }),
  };
}
