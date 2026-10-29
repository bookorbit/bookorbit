import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { Permission, type CreateReadAloudJobRequest, type ReadAloudCapability, type ReadAloudJobInput } from '@bookorbit/types'
import { activateI18nLocale, i18n } from '@/i18n'
import { formatLanguageName } from '@/i18n/formatters'
import ReadAloudDialog from '../components/ReadAloudDialog.vue'
import { makeCapability } from './fixtures'

const mocks = vi.hoisted(() => ({
  permissions: new Set<string>(),
  savedLanguage: null as string | null,
  saveOk: true,
  api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (name: string) => mocks.permissions.has(name) }),
}))

vi.mock('@/lib/api', () => ({ api: mocks.api }))

const t = i18n.global.t

const DialogContentStub = defineComponent({ name: 'DialogContentStub', emits: ['closeAutoFocus'], template: '<div><slot /></div>' })

const DIALOG_STUBS = {
  DialogRoot: { template: '<div><slot /></div>' },
  DialogPortal: { template: '<div><slot /></div>' },
  DialogOverlay: { template: '<div />' },
  DialogContent: DialogContentStub,
  DialogTitle: { template: '<h2><slot /></h2>' },
  DialogDescription: { template: '<p><slot /></p>' },
}

let wrapper: VueWrapper | null = null

beforeAll(() => {
  activateI18nLocale('en')
})

beforeEach(() => {
  mocks.permissions = new Set([Permission.LibraryDeleteBooks])
  mocks.savedLanguage = null
  mocks.saveOk = true
  mocks.api.mockReset()
  mocks.api.mockImplementation(async (_url, init) => {
    if (init?.method === 'PUT') return new Response(null, { status: mocks.saveOk ? 204 : 500 })
    return new Response(JSON.stringify({ settings: { defaultLanguage: mocks.savedLanguage } }), { status: 200 })
  })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

function mountDialog(props: { capability?: ReadAloudCapability; initial?: ReadAloudJobInput | null; defaultLanguage?: string | null } = {}) {
  wrapper = mount(ReadAloudDialog, {
    attachTo: document.body,
    props: {
      open: true,
      capability: props.capability ?? makeCapability(),
      defaultLanguage: props.defaultLanguage === undefined ? 'en-GB' : props.defaultLanguage,
      initial: props.initial ?? null,
      busy: false,
      error: null,
    },
    global: { stubs: DIALOG_STUBS },
  })
  return wrapper
}

function buttonByLabel(target: VueWrapper, label: string) {
  const button = target.findAll('button').find((candidate) => candidate.attributes('aria-label') === label)
  if (!button) throw new Error(`No button labelled "${label}"`)
  return button
}

function buttonByText(target: VueWrapper, text: string) {
  const button = target.findAll('button').find((candidate) => candidate.text().trim() === text)
  if (!button) throw new Error(`No button with text "${text}"`)
  return button
}

function buttonOrNull(target: VueWrapper, text: string) {
  return target.findAll('button').find((candidate) => candidate.text().trim() === text) ?? null
}

function trackOrder(target: VueWrapper): number[] {
  return target.findAll('li[data-track-id]').map((row) => Number(row.attributes('data-track-id')))
}

async function submit(target: VueWrapper): Promise<CreateReadAloudJobRequest> {
  await buttonByText(target, t('book.detail.files.readAloud.dialog.start')).trigger('click')
  const events = target.emitted('create') as [CreateReadAloudJobRequest][] | undefined
  expect(events).toHaveLength(1)
  return events![0]![0]
}

async function openOrder(target: VueWrapper): Promise<void> {
  await buttonByText(target, t('book.detail.files.readAloud.dialog.changeOrder')).trigger('click')
}

describe('ReadAloudDialog', () => {
  it('returns focus to whatever opened it when it closes', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const dialog = mountDialog()
    dialog.find('button').element.focus()

    const event = new Event('focus', { cancelable: true })
    dialog.findComponent(DialogContentStub).vm.$emit('closeAutoFocus', event)

    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('leaves focus to the dialog when its opener is gone', async () => {
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const dialog = mountDialog()
    opener.remove()

    const event = new Event('focus', { cancelable: true })
    dialog.findComponent(DialogContentStub).vm.$emit('closeAutoFocus', event)

    expect(event.defaultPrevented).toBe(false)
  })

  it('starts with every track in book order, sentence highlighting and the book language', async () => {
    const dialog = mountDialog()

    expect(trackOrder(dialog)).toEqual([102, 103, 104])
    const sentence = dialog.find<HTMLInputElement>('input[type="radio"][value="sentence"]')
    expect(sentence.element.checked).toBe(true)

    expect(await submit(dialog)).toEqual({ epubFileId: 101, audioFileIds: [102, 103, 104], language: 'en', granularity: 'sentence' })
  })

  it('moves rows for real and submits the new listening order', async () => {
    const dialog = mountDialog()
    await openOrder(dialog)

    await buttonByLabel(dialog, t('book.detail.files.readAloud.dialog.moveUp', { name: '03.mp3' })).trigger('click')
    await nextTick()
    expect(trackOrder(dialog)).toEqual([102, 104, 103])

    await buttonByLabel(dialog, t('book.detail.files.readAloud.dialog.moveUp', { name: '03.mp3' })).trigger('click')
    await nextTick()
    expect(trackOrder(dialog)).toEqual([104, 102, 103])

    const checkboxes = dialog.findAll('li[data-track-id] input[type="checkbox"]')
    expect(checkboxes[0]!.attributes('aria-label')).toBe(
      t('book.detail.files.readAloud.dialog.trackLabel', { position: 1, total: 3, name: '03.mp3' }),
    )

    expect((await submit(dialog)).audioFileIds).toEqual([104, 102, 103])
  })

  it('keeps focus on the moved row and hands it to the other button at the top', async () => {
    const dialog = mountDialog()
    await openOrder(dialog)

    const upFromMiddle = buttonByLabel(dialog, t('book.detail.files.readAloud.dialog.moveUp', { name: '02.mp3' }))
    ;(upFromMiddle.element as HTMLButtonElement).focus()
    await upFromMiddle.trigger('click')
    await nextTick()
    await nextTick()

    expect(trackOrder(dialog)).toEqual([103, 102, 104])
    // It reached the top, where "up" has nothing left to do.
    expect(document.activeElement?.getAttribute('aria-label')).toBe(t('book.detail.files.readAloud.dialog.moveDown', { name: '02.mp3' }))

    const live = dialog.find('[aria-live="polite"]')
    expect(live.text()).toBe(t('book.detail.files.readAloud.dialog.moved', { name: '02.mp3', position: 1, total: 3 }))
  })

  it('does nothing when the top row is moved up, without disabling the focused button', async () => {
    const dialog = mountDialog()
    await openOrder(dialog)

    const up = buttonByLabel(dialog, t('book.detail.files.readAloud.dialog.moveUp', { name: '01.mp3' }))
    expect(up.attributes('disabled')).toBeUndefined()
    expect(up.attributes('aria-disabled')).toBe('true')
    await up.trigger('click')

    expect(trackOrder(dialog)).toEqual([102, 103, 104])
  })

  it('keeps a skipped track in place so ticking it again restores its position', async () => {
    const dialog = mountDialog()
    await openOrder(dialog)

    const middle = () => dialog.findAll('li[data-track-id]')[1]!.find('input[type="checkbox"]')
    await middle().setValue(false)
    expect(trackOrder(dialog)).toEqual([102, 103, 104])
    expect((await submit(dialog)).audioFileIds).toEqual([102, 104])

    await middle().setValue(true)
    await buttonByText(dialog, t('book.detail.files.readAloud.dialog.start')).trigger('click')
    const events = dialog.emitted('create') as [CreateReadAloudJobRequest][]
    expect(events[1]![0].audioFileIds).toEqual([102, 103, 104])
  })

  it('defaults to replacing a read-along BookOrbit made', async () => {
    const dialog = mountDialog({
      capability: makeCapability({
        existingReadAlongs: [{ fileId: 300, filename: 'book.readaloud.epub', sizeBytes: 900, generatedByJobId: 'job-1' }],
      }),
    })

    const replace = dialog.find<HTMLInputElement>('input[type="radio"][value="300"]')
    expect(replace.element.checked).toBe(true)
    expect((await submit(dialog)).replaceFileId).toBe(300)
  })

  it('defaults to keeping both when the read-along was imported, and sends no replaceFileId', async () => {
    const dialog = mountDialog({
      capability: makeCapability({
        existingReadAlongs: [{ fileId: 300, filename: 'storyteller.epub', sizeBytes: 900, generatedByJobId: null }],
      }),
    })

    expect(dialog.find<HTMLInputElement>('input[type="radio"][value="keep"]').element.checked).toBe(true)
    const input = await submit(dialog)
    expect(input).not.toHaveProperty('replaceFileId')
  })

  it('replaces the read-along the user picked when there are several', async () => {
    const dialog = mountDialog({
      capability: makeCapability({
        existingReadAlongs: [
          { fileId: 300, filename: 'a.readaloud.epub', sizeBytes: 900, generatedByJobId: 'job-1' },
          { fileId: 301, filename: 'imported.epub', sizeBytes: 900, generatedByJobId: null },
        ],
      }),
    })

    await dialog.find('input[type="radio"][value="301"]').setValue(true)
    expect((await submit(dialog)).replaceFileId).toBe(301)
  })

  it('offers no replacement to someone who may not delete books, and sends no replaceFileId', async () => {
    mocks.permissions = new Set()
    const dialog = mountDialog({
      capability: makeCapability({
        existingReadAlongs: [{ fileId: 300, filename: 'book.readaloud.epub', sizeBytes: 900, generatedByJobId: 'job-1' }],
      }),
    })

    expect(dialog.find('input[type="radio"][value="300"]').exists()).toBe(false)
    expect(dialog.find('input[type="radio"][value="keep"]').exists()).toBe(false)
    const existing = dialog.get('[data-test="read-aloud-existing"]')
    expect(existing.text()).toContain('book.readaloud.epub')
    expect(existing.text()).toContain(t('book.detail.files.readAloud.dialog.existing.replaceNotPermitted'))
    expect(await submit(dialog)).not.toHaveProperty('replaceFileId')
  })

  it('ignores a previous job\'s replacement on "Start over" without delete permission', async () => {
    mocks.permissions = new Set()
    const dialog = mountDialog({
      capability: makeCapability({
        existingReadAlongs: [{ fileId: 300, filename: 'book.readaloud.epub', sizeBytes: 900, generatedByJobId: 'job-1' }],
      }),
      initial: { epubFileId: 101, audioFileIds: [102, 103, 104], language: 'en', granularity: 'sentence', sourceBytes: 0, replaceFileId: 300 },
    })

    expect(await submit(dialog)).not.toHaveProperty('replaceFileId')
  })

  it('keeps the replacement on "Start over" with delete permission', async () => {
    const dialog = mountDialog({
      capability: makeCapability({
        existingReadAlongs: [{ fileId: 300, filename: 'imported.epub', sizeBytes: 900, generatedByJobId: null }],
      }),
      initial: { epubFileId: 101, audioFileIds: [102, 103, 104], language: 'en', granularity: 'sentence', sourceBytes: 0, replaceFileId: 300 },
    })

    expect(dialog.find<HTMLInputElement>('input[type="radio"][value="300"]').element.checked).toBe(true)
    expect((await submit(dialog)).replaceFileId).toBe(300)
  })

  it('names the speech model the server reports, and shows an unknown id as sent', async () => {
    const known = mountDialog()
    expect(known.text()).toContain(t('book.detail.files.readAloud.dialog.model', { model: 'QuartzNet15x5' }))
    known.unmount()

    const unknown = mountDialog({ capability: makeCapability({ model: 'wav2vec2-base' as ReadAloudCapability['model'] }) })
    expect(unknown.text()).toContain(t('book.detail.files.readAloud.dialog.model', { model: 'wav2vec2-base' }))
  })

  it('offers word highlighting without a disclosure, and submits it only when chosen', async () => {
    const dialog = mountDialog()
    const word = dialog.find<HTMLInputElement>('input[type="radio"][value="word"]')
    expect(word.isVisible()).toBe(true)
    expect(word.element.checked).toBe(false)

    await word.setValue(true)

    expect((await submit(dialog)).granularity).toBe('word')
  })

  it('prefills "Start over" from the previous job, skipped tracks included', async () => {
    const dialog = mountDialog({
      initial: { epubFileId: 101, audioFileIds: [104, 102], language: 'de', granularity: 'word', sourceBytes: 0, replaceFileId: null },
    })

    expect(trackOrder(dialog)).toEqual([104, 102, 103])
    expect(await submit(dialog)).toEqual({ epubFileId: 101, audioFileIds: [104, 102], language: 'de', granularity: 'word' })
  })

  it.each(['English', 'english', 'eng'])('picks English for a book whose language is stored as "%s"', async (stored) => {
    const dialog = mountDialog({ defaultLanguage: stored })

    expect(dialog.find('select').element.value).toBe('en')
    expect(dialog.text()).not.toContain(t('book.detail.files.readAloud.dialog.languageUnsupported', { language: stored }))
    expect((await submit(dialog)).language).toBe('en')
  })

  it('prefills "Start over" from a job that stored a full language tag', async () => {
    const dialog = mountDialog({
      defaultLanguage: null,
      initial: { epubFileId: 101, audioFileIds: [102, 103, 104], language: 'en-US', granularity: 'sentence', sourceBytes: 0, replaceFileId: null },
    })

    expect((await submit(dialog)).language).toBe('en')
  })

  it('leaves the language unset and says why when the book language has no model', async () => {
    const dialog = mountDialog({ defaultLanguage: 'nl' })

    expect(dialog.find('select').element.value).toBe('')
    expect(dialog.text()).toContain(t('book.detail.files.readAloud.dialog.languageUnsupported', { language: formatLanguageName('nl') }))
    const start = buttonByText(dialog, t('book.detail.files.readAloud.dialog.start'))
    expect(start.attributes('disabled')).toBeDefined()
  })

  it('fills in the saved default when the book states no language', async () => {
    mocks.savedLanguage = 'de'
    const dialog = mountDialog({ defaultLanguage: null })
    await flushPromises()

    expect(dialog.find('select').element.value).toBe('de')
    expect(dialog.text()).toContain(t('book.detail.files.readAloud.dialog.languageIsDefault'))
    expect(buttonOrNull(dialog, t('book.detail.files.readAloud.dialog.setDefaultLanguage'))).toBeNull()
  })

  it("keeps the book's own language over the saved default", async () => {
    mocks.savedLanguage = 'de'
    const dialog = mountDialog({ defaultLanguage: 'English' })
    await flushPromises()

    expect(dialog.find('select').element.value).toBe('en')
    expect(dialog.text()).toContain(t('book.detail.files.readAloud.dialog.languageFromBook'))
  })

  it('uses the saved default for an unsupported book language and still says why', async () => {
    mocks.savedLanguage = 'en'
    const dialog = mountDialog({ defaultLanguage: 'nl' })
    await flushPromises()

    expect(dialog.find('select').element.value).toBe('en')
    expect(dialog.text()).toContain(t('book.detail.files.readAloud.dialog.languageUnsupported', { language: formatLanguageName('nl') }))
  })

  it('never overrides a language picked before the saved default arrives', async () => {
    mocks.savedLanguage = 'de'
    const dialog = mountDialog({ defaultLanguage: null })
    await dialog.find('select').setValue('fr')
    await flushPromises()

    expect(dialog.find('select').element.value).toBe('fr')
  })

  it('saves the chosen language as the default and confirms it', async () => {
    const dialog = mountDialog()
    await flushPromises()
    await dialog.find('select').setValue('fr')

    await buttonByText(dialog, t('book.detail.files.readAloud.dialog.setDefaultLanguage')).trigger('click')
    await flushPromises()

    expect(mocks.api).toHaveBeenCalledWith('/api/v1/user-preferences/read-aloud', expect.objectContaining({ method: 'PUT' }))
    const [, init] = mocks.api.mock.calls.find(([, options]) => options?.method === 'PUT')!
    expect(JSON.parse(init!.body as string)).toEqual({ settings: { defaultLanguage: 'fr' } })
    expect(dialog.text()).toContain(t('book.detail.files.readAloud.dialog.languageSavedAsDefault'))
    expect(buttonOrNull(dialog, t('book.detail.files.readAloud.dialog.setDefaultLanguage'))).toBeNull()
    expect(document.activeElement).toBe(dialog.find('select').element)
  })

  it('says so when the default could not be saved', async () => {
    mocks.saveOk = false
    const dialog = mountDialog()
    await flushPromises()

    await buttonByText(dialog, t('book.detail.files.readAloud.dialog.setDefaultLanguage')).trigger('click')
    await flushPromises()

    const alert = dialog.findAll('[role="alert"]').find((node) => node.text() === t('book.detail.files.readAloud.dialog.defaultLanguageFailed'))
    expect(alert).toBeDefined()
    expect(buttonOrNull(dialog, t('book.detail.files.readAloud.dialog.setDefaultLanguage'))).not.toBeNull()
  })

  it('shows its own error once', () => {
    wrapper = mount(ReadAloudDialog, {
      props: {
        open: true,
        capability: makeCapability(),
        defaultLanguage: 'en',
        initial: null,
        busy: false,
        error: 'book.detail.files.readAloud.errors.createConflict',
      },
      global: { stubs: DIALOG_STUBS },
    })

    const alerts = wrapper.findAll('[role="alert"]')
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.text()).toBe(t('book.detail.files.readAloud.errors.createConflict'))
  })
})
