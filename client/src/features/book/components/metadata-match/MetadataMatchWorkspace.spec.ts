import { describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import type { MetadataCandidate, MetadataProviderInfo, MetadataSource } from '@bookorbit/types'
import MetadataMatchWorkspace from './MetadataMatchWorkspace.vue'
import type { MetadataDiffApply } from '../../composables/useMetadataDiff'

const current: MetadataSource = {
  title: 'Artemis Fowl',
  subtitle: null,
  authors: ['Eoin Colfer'],
  genres: ['Fantasy'],
  description: null,
  publisher: 'Miramax',
  publishedDate: '2003-04-01',
  publishedYear: 2003,
  language: 'English',
  pageCount: 396,
  seriesName: 'Artemis Fowl',
  seriesIndex: '1',
  isbn10: null,
  isbn13: null,
  narrators: [],
  durationSeconds: null,
  abridged: null,
  hardcoverEditionId: null,
  communityRatings: [],
}

const providers: MetadataProviderInfo[] = [
  { key: 'amazon', label: 'Amazon', identifiable: true },
  { key: 'goodreads', label: 'Goodreads', identifiable: true },
  { key: 'google', label: 'Google Books', identifiable: true },
]

const amazon: MetadataCandidate = {
  provider: 'amazon',
  providerId: 'B002KP6DXQ',
  title: 'Artemis Fowl',
  authors: ['Eoin Colfer'],
  publisher: 'Disney Hyperion',
  isbn13: '9781423132172',
  seriesName: 'Artemis Fowl',
  seriesIndex: '1',
}
const goodreads: MetadataCandidate = {
  provider: 'goodreads',
  providerId: 'gr-other',
  title: 'Artemis Fowl',
  authors: ['Eoin Colfer'],
  pageCount: 420,
}
const collection: MetadataCandidate = { provider: 'google', providerId: 'set', title: 'Artemis Fowl: Books 1-4', authors: ['Eoin Colfer'] }

function mountWorkspace(props: Partial<InstanceType<typeof MetadataMatchWorkspace>['$props']> = {}) {
  return mount(MetadataMatchWorkspace, {
    attachTo: document.body,
    props: {
      current,
      providerIds: { amazon: 'B002KP6DXQ' },
      coverMedium: 'ebook',
      searchDefaults: { title: 'Artemis Fowl', author: 'Eoin Colfer' },
      providers,
      results: [collection, goodreads, amazon],
      providerCounts: { amazon: 1, goodreads: 1, google: 1 },
      selectedProviders: ['amazon', 'goodreads', 'google'],
      interruptedProviders: [],
      isStreaming: false,
      hasSearched: true,
      ...props,
    },
  })
}

function resultRows(wrapper: VueWrapper) {
  return wrapper.findAll('[data-match-results] button[class*="grid"]')
}

function fieldRow(wrapper: VueWrapper, key: string) {
  return wrapper.get(`[data-field-key="${key}"]`)
}

async function choose(wrapper: VueWrapper, key: string, option: string) {
  const button = fieldRow(wrapper, key)
    .findAll('[role="radio"]')
    .find((radio) => radio.text() === option)
  await button!.trigger('click')
}

describe('MetadataMatchWorkspace', () => {
  it('groups results by how likely they are this book and opens the linked record', () => {
    const wrapper = mountWorkspace()

    const headings = wrapper.findAll('[data-match-results] h3').map((heading) => heading.text())
    expect(headings).toEqual([expect.stringContaining('Best matches'), expect.stringContaining('Other editions')])
    expect(wrapper.text()).toContain('Probably different books')
    expect(wrapper.text()).not.toContain('Artemis Fowl: Books 1-4')

    const selected = wrapper.get('[data-match-results] [aria-current="true"]')
    expect(selected.text()).toContain('Amazon')
    expect(selected.text()).toContain('Linked')
    wrapper.unmount()
  })

  it('moves to a better match that arrives later, until someone picks a result', async () => {
    const wrapper = mountWorkspace({ results: [goodreads], isStreaming: true })
    await wrapper.setProps({ results: [goodreads, amazon], isStreaming: false })
    expect(wrapper.get('[data-match-results] [aria-current="true"]').text()).toContain('Amazon')

    const other = resultRows(wrapper).find((row) => row.text().includes('Goodreads'))!
    await other.trigger('click')
    await wrapper.setProps({ results: [goodreads, amazon, { ...amazon, providerId: 'isbn', isbn13: undefined }] })

    expect(wrapper.get('[data-match-results] [aria-current="true"]').text()).toContain('Goodreads')
    wrapper.unmount()
  })

  it('applies the staged fields with the id of every result they came from', async () => {
    const wrapper = mountWorkspace()

    await choose(wrapper, 'publisher', 'Use')
    await choose(wrapper, 'isbn13', 'Use')
    expect(wrapper.get('footer').text()).toContain('Apply 2 changes')

    const apply = wrapper
      .get('footer')
      .findAll('button')
      .find((button) => button.text().startsWith('Apply'))!
    await apply.trigger('click')

    const [patch] = wrapper.emitted('apply')![0] as [MetadataDiffApply]
    expect(patch.formPatch).toMatchObject({ publisher: 'Disney Hyperion', isbn13: '9781423132172', amazonId: 'B002KP6DXQ' })
    wrapper.unmount()
  })

  it('keeps a staged value when another result is opened, and names where it came from', async () => {
    const wrapper = mountWorkspace()

    await choose(wrapper, 'isbn13', 'Use')
    await resultRows(wrapper)
      .find((row) => row.text().includes('Goodreads'))!
      .trigger('click')

    expect(wrapper.get('footer').text()).toContain('Apply 1 change')
    const amazonRow = resultRows(wrapper).find((row) => row.text().includes('Amazon'))!
    expect(amazonRow.text()).toContain('1 change staged from this result')
    wrapper.unmount()
  })

  it('only lists fields that differ until all fields are asked for', async () => {
    const wrapper = mountWorkspace()

    expect(wrapper.find('[data-field-key="title"]').exists()).toBe(false)
    const all = wrapper.findAll('[role="radio"]').find((radio) => radio.text().startsWith('All fields'))!
    await all.trigger('click')

    expect(fieldRow(wrapper, 'title').text()).toContain('Already matches')
    wrapper.unmount()
  })

  it('offers a retry for a source that stopped early', async () => {
    const wrapper = mountWorkspace({ interruptedProviders: [{ provider: 'google', outcome: 'timeout' }] })

    const retry = wrapper.findAll('button').find((button) => button.text() === 'Retry Google Books')!
    await retry.trigger('click')

    expect(wrapper.emitted('retryProvider')).toEqual([['google']])
    wrapper.unmount()
  })

  it('compares a fixed result on its own, without the results list', () => {
    const fetched: MetadataCandidate = {
      provider: 'auto' as MetadataCandidate['provider'],
      providerId: '',
      title: 'Artemis Fowl',
      publisher: 'Viking',
    }
    const wrapper = mountWorkspace({ results: [], fixedCandidate: fetched })

    expect(wrapper.find('[data-match-results]').exists()).toBe(false)
    expect(fieldRow(wrapper, 'publisher').text()).toContain('Viking')
    expect(wrapper.text()).toContain('Fetched')
    wrapper.unmount()
  })
})
