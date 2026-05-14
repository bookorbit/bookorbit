import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api', () => ({
  api: vi.fn<(...args: Parameters<typeof import('@/lib/api').api>) => Promise<Response>>(),
}))

import { api } from '@/lib/api'
import {
  listSupportedSourceTypes,
  getWorkflowState,
  listTargetUsers,
  listSourcePathPrefixes,
  listTargetLibraryFolders,
  createSource,
  testSource,
  validateSourceById,
  suggestUserMappings,
  validatePathMappings,
  createProfile,
  createDryRunPlan,
  resolveDuplicateMatches,
  startLiveRun,
  getRunProgress,
  getRunReport,
  exportRunReport,
  cancelRun,
  retryRun,
} from './migration-api'

const mockApi = vi.mocked(api)

function okResponse(body: unknown, headers?: Record<string, string>): Response {
  const h = new Headers(headers)
  return {
    ok: true,
    status: 200,
    json: vi.fn<() => Promise<unknown>>().mockResolvedValue(body),
    text: vi.fn<() => Promise<string>>().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
    headers: h,
  } as unknown as Response
}

function errorResponse(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    json: vi.fn<() => Promise<unknown>>().mockResolvedValue(body),
    text: vi.fn<() => Promise<string>>().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
    headers: new Headers(),
  } as unknown as Response
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('expectJson helper', () => {
  it('returns parsed JSON on ok response', async () => {
    mockApi.mockResolvedValue(okResponse(['booklore']))
    const result = await listSupportedSourceTypes()
    expect(result).toEqual(['booklore'])
  })

  it('throws error with message from payload on non-ok response', async () => {
    mockApi.mockResolvedValue(errorResponse(400, { message: 'Validation failed' }))
    await expect(listSupportedSourceTypes()).rejects.toThrow('Validation failed')
  })

  it('throws fallback message when error payload has no message field', async () => {
    mockApi.mockResolvedValue(errorResponse(500, { error: 'some error' }))
    await expect(listSupportedSourceTypes()).rejects.toThrow('Failed to load supported migration source types')
  })

  it('throws fallback message when error payload json parse fails', async () => {
    const res: Response = {
      ok: false,
      status: 500,
      json: vi.fn<() => Promise<never>>().mockRejectedValue(new Error('parse error')),
      text: vi.fn<() => Promise<string>>().mockResolvedValue(''),
      headers: new Headers(),
    } as unknown as Response
    mockApi.mockResolvedValue(res)
    await expect(listSupportedSourceTypes()).rejects.toThrow('Failed to load supported migration source types')
  })

  it('throws fallback message when payload.message is not a string', async () => {
    mockApi.mockResolvedValue(errorResponse(500, { message: 42 }))
    await expect(listSupportedSourceTypes()).rejects.toThrow('Failed to load supported migration source types')
  })
})

describe('listSupportedSourceTypes', () => {
  it('calls the supported-types endpoint', async () => {
    mockApi.mockResolvedValue(okResponse(['booklore']))
    await listSupportedSourceTypes()
    expect(mockApi).toHaveBeenCalledWith('/api/v1/migration/supported-types')
  })
})

describe('getWorkflowState', () => {
  it('calls the state endpoint and returns workflow state', async () => {
    const state = { active: null, hasActiveRun: false }
    mockApi.mockResolvedValue(okResponse(state))
    const result = await getWorkflowState()
    expect(result).toEqual(state)
    expect(mockApi).toHaveBeenCalledWith('/api/v1/migration/state')
  })
})

describe('listTargetUsers', () => {
  it('calls the target-users endpoint', async () => {
    const users = [{ id: 1, username: 'alice', name: 'Alice', email: null }]
    mockApi.mockResolvedValue(okResponse(users))
    const result = await listTargetUsers()
    expect(result).toEqual(users)
    expect(mockApi).toHaveBeenCalledWith('/api/v1/migration/target-users')
  })
})

describe('listSourcePathPrefixes', () => {
  it('calls the path-prefixes endpoint with sourceId', async () => {
    mockApi.mockResolvedValue(okResponse({ prefixes: ['/books'] }))
    const result = await listSourcePathPrefixes(42)
    expect(result).toEqual({ prefixes: ['/books'] })
    expect(mockApi).toHaveBeenCalledWith('/api/v1/migration/sources/42/path-prefixes')
  })
})

describe('listTargetLibraryFolders', () => {
  it('flattens libraries into folder entries', async () => {
    const libs = [
      { id: 1, name: 'Fiction', folders: [{ id: 10, path: '/books/fiction' }] },
      {
        id: 2,
        name: 'Non-Fiction',
        folders: [
          { id: 20, path: '/books/nonfiction' },
          { id: 21, path: '/books/other' },
        ],
      },
    ]
    mockApi.mockResolvedValue(okResponse(libs))
    const result = await listTargetLibraryFolders()
    expect(result).toEqual([
      { libraryName: 'Fiction', path: '/books/fiction' },
      { libraryName: 'Non-Fiction', path: '/books/nonfiction' },
      { libraryName: 'Non-Fiction', path: '/books/other' },
    ])
  })

  it('throws error when libraries request fails', async () => {
    mockApi.mockResolvedValue(errorResponse(500, {}))
    await expect(listTargetLibraryFolders()).rejects.toThrow('Failed to load libraries')
  })
})

describe('createSource', () => {
  it('posts to sources endpoint and returns created source', async () => {
    const source = { id: 1, type: 'booklore', name: 'My Source' }
    mockApi.mockResolvedValue(okResponse(source))
    const result = await createSource({ type: 'booklore', name: 'My Source', connectionConfig: { host: 'localhost' } })
    expect(result).toEqual(source)
    expect(mockApi).toHaveBeenCalledWith('/api/v1/migration/sources', expect.objectContaining({ method: 'POST' }))
  })
})

describe('testSource', () => {
  it('posts to sources/test endpoint', async () => {
    mockApi.mockResolvedValue(okResponse({ ok: true }))
    const result = await testSource({ type: 'booklore', connectionConfig: { host: 'localhost' } })
    expect(result).toEqual({ ok: true })
    expect(mockApi).toHaveBeenCalledWith('/api/v1/migration/sources/test', expect.objectContaining({ method: 'POST' }))
  })
})

describe('validateSourceById', () => {
  it('posts to sources/:id/validate endpoint', async () => {
    mockApi.mockResolvedValue(okResponse({ ok: true, warnings: [] }))
    const result = await validateSourceById(5)
    expect(result).toEqual({ ok: true, warnings: [] })
    expect(mockApi).toHaveBeenCalledWith('/api/v1/migration/sources/5/validate', expect.objectContaining({ method: 'POST' }))
  })
})

describe('suggestUserMappings', () => {
  it('gets user mapping suggestions for a source', async () => {
    const payload = { sourceId: 1, generatedAt: 'now', suggestions: [] }
    mockApi.mockResolvedValue(okResponse(payload))
    const result = await suggestUserMappings(1)
    expect(result).toEqual(payload)
    expect(mockApi).toHaveBeenCalledWith('/api/v1/migration/sources/1/user-mapping-suggestions')
  })
})

describe('validatePathMappings', () => {
  it('posts path mappings for validation', async () => {
    const response = { sourceId: 1, validatedAt: 'now', pathMappingsHash: 'abc', persistedProfileId: null, summary: {}, mappings: [] }
    mockApi.mockResolvedValue(okResponse(response))
    const result = await validatePathMappings(1, { pathMappings: [{ sourcePrefix: '/src', targetPrefix: '/tgt' }] })
    expect(result).toEqual(response)
    expect(mockApi).toHaveBeenCalledWith('/api/v1/migration/sources/1/path-mappings/validate', expect.objectContaining({ method: 'POST' }))
  })
})

describe('createProfile', () => {
  it('posts to profiles endpoint', async () => {
    const profile = { id: 1, name: 'Test Profile', sourceId: 1 }
    mockApi.mockResolvedValue(okResponse(profile))
    const result = await createProfile({ sourceId: 1, name: 'Test Profile', userMappings: [] })
    expect(result).toEqual(profile)
    expect(mockApi).toHaveBeenCalledWith('/api/v1/migration/profiles', expect.objectContaining({ method: 'POST' }))
  })
})

describe('createDryRunPlan', () => {
  it('posts to plans/dry-run endpoint', async () => {
    const plan = { id: 1, profileId: 1 }
    mockApi.mockResolvedValue(okResponse(plan))
    const result = await createDryRunPlan({ profileId: 1 })
    expect(result).toEqual(plan)
    expect(mockApi).toHaveBeenCalledWith('/api/v1/migration/plans/dry-run', expect.objectContaining({ method: 'POST' }))
  })
})

describe('resolveDuplicateMatches', () => {
  it('posts resolutions to plan artifact endpoint', async () => {
    const artifact = { id: 7 }
    mockApi.mockResolvedValue(okResponse(artifact))
    const result = await resolveDuplicateMatches(7, [{ targetBookId: 100, selectedSourceBookId: 's1' }])
    expect(result).toEqual(artifact)
    expect(mockApi).toHaveBeenCalledWith('/api/v1/migration/plans/7/resolve-duplicates', expect.objectContaining({ method: 'POST' }))
  })
})

describe('startLiveRun', () => {
  it('posts to runs/live endpoint', async () => {
    const run = { id: 99, state: 'running' }
    mockApi.mockResolvedValue(okResponse(run))
    const result = await startLiveRun({ planArtifactId: 7 })
    expect(result).toEqual(run)
    expect(mockApi).toHaveBeenCalledWith('/api/v1/migration/runs/live', expect.objectContaining({ method: 'POST' }))
  })
})

describe('getRunProgress', () => {
  it('fetches progress for a run', async () => {
    const progress = { run: { id: 1 }, totals: {}, metrics: [] }
    mockApi.mockResolvedValue(okResponse(progress))
    const result = await getRunProgress(1)
    expect(result).toEqual(progress)
    expect(mockApi).toHaveBeenCalledWith('/api/v1/migration/runs/1/progress')
  })
})

describe('getRunReport', () => {
  it('fetches report for a run', async () => {
    const report = { run: { id: 1 }, totals: {}, metrics: [], plan: null, summary: null, details: {} }
    mockApi.mockResolvedValue(okResponse(report))
    const result = await getRunReport(1)
    expect(result).toEqual(report)
    expect(mockApi).toHaveBeenCalledWith('/api/v1/migration/runs/1/report')
  })
})

describe('exportRunReport', () => {
  it('returns file content with disposition filename for json format', async () => {
    const res = {
      ok: true,
      headers: new Headers({ 'Content-Disposition': 'attachment; filename="report.json"', 'Content-Type': 'application/json' }),
      text: vi.fn<() => Promise<string>>().mockResolvedValue('{"foo":"bar"}'),
    } as unknown as Response
    mockApi.mockResolvedValue(res)
    const result = await exportRunReport(1, 'json')
    expect(result.fileName).toBe('report.json')
    expect(result.format).toBe('json')
    expect(result.content).toBe('{"foo":"bar"}')
    expect(result.contentType).toBe('application/json')
  })

  it('uses fallback filename when Content-Disposition is absent', async () => {
    const res = {
      ok: true,
      headers: new Headers({}),
      text: vi.fn<() => Promise<string>>().mockResolvedValue('a,b'),
    } as unknown as Response
    mockApi.mockResolvedValue(res)
    const result = await exportRunReport(3, 'csv')
    expect(result.fileName).toBe('migration-run-3-report.csv')
    expect(result.contentType).toBe('text/csv')
  })

  it('throws error with body text when response is not ok', async () => {
    const res = {
      ok: false,
      headers: new Headers(),
      text: vi.fn<() => Promise<string>>().mockResolvedValue('Export failed'),
    } as unknown as Response
    mockApi.mockResolvedValue(res)
    await expect(exportRunReport(1, 'json')).rejects.toThrow('Export failed')
  })

  it('throws fallback error when response is not ok and body is empty', async () => {
    const res = {
      ok: false,
      headers: new Headers(),
      text: vi.fn<() => Promise<string>>().mockResolvedValue(''),
    } as unknown as Response
    mockApi.mockResolvedValue(res)
    await expect(exportRunReport(1, 'csv')).rejects.toThrow('Failed to export migration report')
  })
})

describe('cancelRun', () => {
  it('posts to cancel endpoint', async () => {
    const run = { id: 1, state: 'cancelled' }
    mockApi.mockResolvedValue(okResponse(run))
    const result = await cancelRun(1)
    expect(result).toEqual(run)
    expect(mockApi).toHaveBeenCalledWith('/api/v1/migration/runs/1/cancel', expect.objectContaining({ method: 'POST' }))
  })
})

describe('retryRun', () => {
  it('posts to retry endpoint', async () => {
    const run = { id: 1, state: 'running' }
    mockApi.mockResolvedValue(okResponse(run))
    const result = await retryRun(1)
    expect(result).toEqual(run)
    expect(mockApi).toHaveBeenCalledWith('/api/v1/migration/runs/1/retry', expect.objectContaining({ method: 'POST' }))
  })
})
