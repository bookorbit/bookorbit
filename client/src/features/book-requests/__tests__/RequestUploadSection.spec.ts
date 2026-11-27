import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { BookRequestItem, BookRequestUploadPlan, BookRequestUploadPlanFile, BookRequestUploadPlanUnit } from '@bookorbit/types'

import RequestUploadSection from '../components/RequestUploadSection.vue'
import type { RequestUploadFile, RequestUploadState } from '../composables/useRequestUpload'

const MB = 1024 * 1024

const request = {
  id: 5,
  title: 'The Silent Patient',
  mediaKind: 'audiobook',
  targetBookId: 12,
  targetLibraryName: 'Novels',
} as BookRequestItem

function file(path: string, sizeBytes: number, overrides: Partial<BookRequestUploadPlanFile> = {}): BookRequestUploadPlanFile {
  return { path, sizeBytes, format: path.split('.').pop()!, role: 'content', unitIndex: 0, skipReason: null, tooLarge: false, ...overrides }
}

function unit(overrides: Partial<BookRequestUploadPlanUnit> = {}): BookRequestUploadPlanUnit {
  return {
    index: 0,
    mediaKind: 'audiobook',
    title: 'The Silent Patient',
    contentFileCount: 38,
    totalFileCount: 39,
    sizeBytes: 612 * MB,
    formats: ['mp3'],
    matchesMedium: true,
    matchesTitle: true,
    ...overrides,
  }
}

const tracks = Array.from({ length: 38 }, (_, index) => file(`Silent/${String(index + 1).padStart(2, '0')}.mp3`, 16 * MB))

function plan(overrides: Partial<BookRequestUploadPlan> = {}): BookRequestUploadPlan {
  return {
    status: 'ready',
    rootName: 'Silent',
    units: [unit()],
    selectedUnitIndex: 0,
    files: [
      ...tracks,
      file('Silent/cover.jpg', 412 * 1024, { role: 'artwork' }),
      file('Silent/.DS_Store', 6144, { role: 'skipped', unitIndex: null, skipReason: 'hidden' }),
    ],
    maxFileSizeBytes: 4096 * MB,
    ...overrides,
  }
}

function state(overrides: Partial<RequestUploadState> = {}): RequestUploadState {
  return {
    requestId: 5,
    picked: Array.from({ length: 40 }, () => ({ file: new File([], 'x'), path: 'x' })),
    plan: plan(),
    planning: false,
    planError: null,
    planReason: null,
    chosenUnit: null,
    holdForReview: false,
    starting: false,
    downloadId: null,
    files: [],
    ...overrides,
  }
}

function mountSection(value: RequestUploadState, target: BookRequestItem = request) {
  return mount(RequestUploadSection, { props: { request: target, state: value, busy: false } })
}

describe('RequestUploadSection', () => {
  it('says what a dropped audiobook folder comes to and where it goes', () => {
    const text = mountSection(state()).text()

    expect(text).toContain('Your files')
    expect(text).toContain('40 files')
    expect(text).toContain('One audiobook · 38 tracks')
    expect(text).toContain('MP3 with cover art')
    expect(text).toContain('Matches the request')
    expect(text).toContain('Joins The Silent Patient as its audiobook')
    expect(text).toContain('Let me check the match before it is filed')
  })

  it('shows the start of the book, the cover and the skipped file, and folds the rest away', async () => {
    const wrapper = mountSection(state())
    const rows = () => wrapper.findAll('ul[aria-label="Picked files"] > li')

    expect(rows()).toHaveLength(6)
    expect(wrapper.text()).toContain('Skipped: Hidden file')
    expect(wrapper.text()).toContain('35 more tracks')

    await wrapper.find('button[aria-expanded="false"]').trigger('click')
    expect(rows()).toHaveLength(40)
  })

  it('offers one book out of several as a single choice', async () => {
    const units = [
      unit({ mediaKind: 'ebook', title: 'Mexican Gothic', formats: ['epub'], matchesTitle: true }),
      unit({ index: 1, mediaKind: 'ebook', title: 'Gods of Jade and Shadow', formats: ['epub'], matchesTitle: false }),
    ]
    const ebook = { ...request, mediaKind: 'ebook', targetBookId: null, targetLibraryName: 'ReadAloud+' } as BookRequestItem
    const wrapper = mountSection(state({ plan: plan({ status: 'choose', units, selectedUnitIndex: 0, files: [] }), chosenUnit: 0 }), ebook)

    const radios = wrapper.findAll('[role="radio"]')
    expect(radios.map((radio) => radio.attributes('aria-checked'))).toEqual(['true', 'false'])
    expect(wrapper.text()).toContain('2 different books')
    expect(wrapper.text()).toContain('Matches the title')
    expect(wrapper.find('ul[aria-label="Picked files"]').exists()).toBe(false)

    await radios[1]!.trigger('click')
    expect(wrapper.emitted('chooseUnit')).toEqual([[1]])
  })

  it('refuses files of the other medium before anything is sent', () => {
    const ebook = { ...request, mediaKind: 'ebook' } as BookRequestItem
    const wrapper = mountSection(state({ plan: plan({ status: 'wrong_medium', selectedUnitIndex: null }) }), ebook)

    expect(wrapper.text()).toContain('Not an e-book')
    expect(wrapper.find('[role="alert"]').text()).toContain('This request is for the e-book')
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
  })

  it('names the file over the size limit', () => {
    const big = plan({ status: 'file_too_large', files: [file('Silent/01.mp3', 5000 * MB, { tooLarge: true })], maxFileSizeBytes: 4096 * MB })

    expect(
      mountSection(state({ plan: big }))
        .find('[role="alert"]')
        .text(),
    ).toContain('01.mp3 is')
  })

  it('passes the hold choice up', async () => {
    const wrapper = mountSection(state())

    await wrapper.find('input[type="checkbox"]').setValue(true)
    expect(wrapper.emitted('hold')).toEqual([[true]])
  })

  describe('once sent', () => {
    function sent(id: number, sentState: RequestUploadFile['state'], overrides: Partial<RequestUploadFile> = {}): RequestUploadFile {
      return {
        id,
        name: `${String(id).padStart(2, '0')}.mp3`,
        path: `${id}.mp3`,
        sizeBytes: 16 * MB,
        sentBytes: 0,
        state: sentState,
        error: null,
        file: new File([], 'x'),
        ...overrides,
      }
    }

    it('shows the latest arrivals, the files moving and how many wait', () => {
      const files = [
        ...Array.from({ length: 5 }, (_, index) => sent(index + 1, 'done')),
        sent(6, 'sending', { sentBytes: 10 * MB }),
        ...Array.from({ length: 4 }, (_, index) => sent(index + 7, 'waiting')),
      ]
      const wrapper = mountSection(state({ downloadId: 90, files }))

      expect(wrapper.text()).toContain('5 of 10 done')
      expect(wrapper.findAll('li')).toHaveLength(5)
      expect(wrapper.text()).toContain('62%')
      expect(wrapper.text()).toContain('4 more waiting')
    })

    it('lists what did not arrive, with a retry for a file this page still holds', async () => {
      const files = [sent(1, 'done'), sent(2, 'failed', { error: 'connection', sentBytes: 9 * MB }), sent(3, 'failed', { file: null })]
      const wrapper = mountSection(state({ downloadId: 90, files }))

      expect(wrapper.text()).toContain('1 of 3 arrived')
      expect(wrapper.text()).toContain('Connection lost at 9 MB of 16 MB')
      expect(wrapper.text()).toContain('Not sent yet')
      expect(wrapper.text()).toContain('1 other file arrived')

      const retries = wrapper.findAll('button[aria-label^="Retry"]')
      expect(retries).toHaveLength(1)
      await retries[0]!.trigger('click')
      expect(wrapper.emitted('retryFile')).toEqual([[2]])
    })
  })
})
