import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { ReleaseFileInspection } from '@bookorbit/types'
import ReleaseFileInspectionPanel from '../components/ReleaseFileInspectionPanel.vue'

function inspection(overrides: Partial<ReleaseFileInspection> = {}): ReleaseFileInspection {
  return {
    source: 'torrent_file',
    status: 'ready',
    files: [{ path: 'Pride and Prejudice/Pride and Prejudice.epub', sizeBytes: 2048, bookFile: true }],
    totalFiles: 1,
    primaryFileCount: 1,
    truncated: false,
    units: [{ mediaKind: 'ebook', title: 'Pride and Prejudice', contentFileCount: 1, totalFileCount: 1, sizeBytes: 2048 }],
    unitCount: 1,
    ignoredFileCount: 0,
    containerCount: 0,
    ...overrides,
  }
}

function mountPanel(
  overrides: Partial<{ inspection: ReleaseFileInspection | null; loading: boolean; failed: boolean; failureReason: string | null }> = {},
) {
  return mount(ReleaseFileInspectionPanel, {
    props: { inspection: inspection(), loading: false, failed: false, ...overrides },
  })
}

describe('ReleaseFileInspectionPanel', () => {
  it('shows the actual manifest path and size', () => {
    const wrapper = mountPanel()

    expect(wrapper.text()).toContain('Pride and Prejudice/Pride and Prejudice.epub')
    expect(wrapper.text()).toContain('2 KB')
    expect(wrapper.get('[role="status"]').text()).toContain('1 file')
  })

  /** Marking every file in a list where every file is a book file marks nothing. */
  it('leaves the files unmarked when they are all book files', () => {
    const wrapper = mountPanel({
      inspection: inspection({
        files: [
          { path: 'Dune/Dune.epub', sizeBytes: 2048, bookFile: true },
          { path: 'Dune/Dune.azw3', sizeBytes: 4096, bookFile: true },
        ],
      }),
    })

    expect(wrapper.text()).not.toContain('Book file')
    expect(wrapper.text()).not.toContain('Extra')
  })

  /** Three formats and a cover: the cover is the exception, so the cover is what gets marked. */
  it('marks the extras rather than the book files when the books are the majority', () => {
    const wrapper = mountPanel({
      inspection: inspection({
        files: [
          { path: 'Dune/Dune.epub', sizeBytes: 2048, bookFile: true },
          { path: 'Dune/Dune.azw3', sizeBytes: 4096, bookFile: true },
          { path: 'Dune/Dune.mobi', sizeBytes: 4096, bookFile: true },
          { path: 'Dune/cover.jpg', sizeBytes: 1024, bookFile: false },
        ],
      }),
    })

    expect(wrapper.text()).toContain('Extra')
    expect(wrapper.text()).not.toContain('Book file')
  })

  /** One epub in a pack of junk: now the book file is the exception, so it is marked instead. */
  it('marks the book files when they are the minority', () => {
    const wrapper = mountPanel({
      inspection: inspection({
        files: [
          { path: 'pack/Dune.epub', sizeBytes: 2048, bookFile: true },
          { path: 'pack/readme.nfo', sizeBytes: 512, bookFile: false },
          { path: 'pack/sample.txt', sizeBytes: 512, bookFile: false },
        ],
      }),
    })

    expect(wrapper.text()).toContain('Book file')
    expect(wrapper.text()).not.toContain('Extra')
  })

  it('warns when a torrent has no directly supported book file', () => {
    const wrapper = mountPanel({
      inspection: inspection({
        status: 'no_supported_file',
        files: [{ path: 'release/book.zip', sizeBytes: 8192, bookFile: false }],
        primaryFileCount: 0,
      }),
    })

    expect(wrapper.get('[role="alert"]').text()).toContain('no directly supported book file')
    expect(wrapper.text()).toContain('release/book.zip')
  })

  it('says how many separate books a release holds, and names them', () => {
    const wrapper = mountPanel({
      inspection: inspection({
        status: 'multiple_supported_files',
        files: [
          { path: 'Mort.epub', sizeBytes: 1024, bookFile: true },
          { path: 'Small Gods.epub', sizeBytes: 1024, bookFile: true },
        ],
        totalFiles: 2,
        primaryFileCount: 2,
        units: [
          { mediaKind: 'ebook', title: 'Mort', contentFileCount: 1, totalFileCount: 1, sizeBytes: 1024 },
          { mediaKind: 'ebook', title: 'Small Gods', contentFileCount: 1, totalFileCount: 1, sizeBytes: 1024 },
        ],
        unitCount: 2,
      }),
    })

    expect(wrapper.get('[role="status"]').text()).toContain('2 separate books')
    expect(wrapper.text()).toContain('Mort')
    expect(wrapper.text()).toContain('Small Gods')
  })

  /** The distinction the old "N supported book files" wording could not draw. */
  it('describes one book made of many parts as a single audiobook, not as many books', () => {
    const wrapper = mountPanel({
      inspection: inspection({
        status: 'ready',
        files: [
          { path: 'Neuromancer/Chapter 1.mp3', sizeBytes: 1024, bookFile: true },
          { path: 'Neuromancer/Chapter 2.mp3', sizeBytes: 1024, bookFile: true },
        ],
        totalFiles: 2,
        primaryFileCount: 2,
        units: [{ mediaKind: 'audiobook', title: 'Neuromancer', contentFileCount: 31, totalFileCount: 32, sizeBytes: 500_000 }],
        unitCount: 1,
      }),
    })

    expect(wrapper.get('[role="status"]').text()).toContain('one book made of 31 files')
    expect(wrapper.text()).toContain('Audiobook')
    expect(wrapper.text()).toContain('31 files')
  })

  /** An archive is extracted after downloading, so it is stated rather than warned about. */
  it('states that an archived release is extracted after downloading', () => {
    const wrapper = mountPanel({
      inspection: inspection({
        status: 'contents_unknown',
        files: [{ path: 'release/book.rar', sizeBytes: 8192, bookFile: false }],
        primaryFileCount: 0,
        units: [],
        unitCount: 0,
        containerCount: 1,
      }),
    })

    expect(wrapper.get('[role="status"]').text()).toContain('packaged as an archive')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('reports the samples and padding files it discarded', () => {
    const wrapper = mountPanel({ inspection: inspection({ ignoredFileCount: 3 }) })

    expect(wrapper.text()).toContain('Ignoring 3 sample and padding files')
  })

  /** A single ordinary book has nothing to add, so the unit list stays out of the way. */
  it('does not list units for a plain one-file release', () => {
    expect(mountPanel().text()).not.toContain('E-book')
  })

  it('explains why magnets have no file list yet', () => {
    const wrapper = mountPanel({
      inspection: inspection({
        source: 'magnet',
        status: 'metadata_unavailable',
        files: [],
        totalFiles: null,
        primaryFileCount: null,
      }),
    })

    expect(wrapper.get('[role="status"]').text()).toContain('until a torrent client fetches the metadata from the swarm')
  })

  it('exposes loading and failed inspection states accessibly', async () => {
    const wrapper = mountPanel({ inspection: null, loading: true })
    expect(wrapper.get('[role="status"]').text()).toContain('Reading the release file list')

    await wrapper.setProps({ loading: false, failed: true })
    expect(wrapper.get('[role="alert"]').text()).toContain('not sent to a download client')
  })

  it('states when the bounded display omits manifest entries', () => {
    const wrapper = mountPanel({ inspection: inspection({ totalFiles: 500, truncated: true }) })

    expect(wrapper.text()).toContain('Showing 1 of 500 files')
  })

  /**
   * A tracker refusing one release says why, and that sentence is the whole answer: it tells an
   * approver to pick another release rather than to retry the same one forever.
   */
  it('repeats what the tracker said when inspection was refused', () => {
    const wrapper = mountPanel({
      inspection: null,
      failed: true,
      failureReason: 'VIP torrent and you are not VIP or higher',
    })

    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('VIP torrent and you are not VIP or higher')
    expect(alert.text()).not.toContain('file list could not be read')
  })

  it('always says what happened to the grab, whatever the reason was', () => {
    const wrapper = mountPanel({ inspection: null, failed: true, failureReason: 'VIP torrent and you are not VIP or higher' })

    expect(wrapper.get('[role="alert"]').text()).toContain('not sent to a download client')
  })

  it('falls back to the generic line when nothing said why', () => {
    const wrapper = mountPanel({ inspection: null, failed: true })

    expect(wrapper.get('[role="alert"]').text()).toContain('file list could not be read')
  })
})
