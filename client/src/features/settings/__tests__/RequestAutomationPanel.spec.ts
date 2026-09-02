import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_BOOK_REQUEST_AUTOMATION_SETTINGS } from '@bookorbit/types'
import type { BookRequestAutomationSettings } from '@bookorbit/types'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))

vi.mock('@/lib/api', () => ({ api: apiMock }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn<(message: string) => void>(), error: vi.fn<(message: string) => void>() } }))

import { toast } from 'vue-sonner'
import RequestAutomationPanel from '../RequestAutomationPanel.vue'

const PATH = '/api/v1/admin/book-request-automation'

function settings(overrides: Partial<BookRequestAutomationSettings> = {}): BookRequestAutomationSettings {
  return { ...DEFAULT_BOOK_REQUEST_AUTOMATION_SETTINGS, ...overrides }
}

function response(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: vi.fn<() => Promise<unknown>>().mockResolvedValue(body) } as unknown as Response
}

async function mountPanel(loaded: BookRequestAutomationSettings = settings()) {
  apiMock.mockImplementation(async (url) => {
    if (url === '/api/v1/admin/request-indexers') {
      return response({
        indexers: [
          { id: 11, name: 'Public books' },
          { id: 12, name: 'Private books' },
        ],
        encryptionConfigured: true,
      })
    }
    if (url === '/api/v1/book-requests/source-status') return response({ configured: 2, enabled: 2 })
    return response(loaded)
  })
  const wrapper = mount(RequestAutomationPanel)
  await flushPromises()
  return wrapper
}

function lastBody(): Record<string, unknown> {
  const [, init] = apiMock.mock.calls.at(-1)!
  return JSON.parse(String(init?.body)) as Record<string, unknown>
}

function sentBodies(): Record<string, unknown>[] {
  return apiMock.mock.calls.filter(([, init]) => init?.body).map(([, init]) => JSON.parse(String(init?.body)) as Record<string, unknown>)
}

/** What the panel has switched off, named so a diff says which control changed rather than how many. */
function disabledControls(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper
    .findAll('input, select, button')
    .filter((control) => control.attributes('disabled') !== undefined)
    .map((control) => control.attributes('aria-label') ?? control.attributes('name') ?? control.attributes('type') ?? control.element.tagName)
}

/** A save the test holds open, so the panel can be inspected mid-flight. */
function heldSave(body: BookRequestAutomationSettings): () => void {
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  apiMock.mockImplementationOnce(async () => {
    await held
    return response(body)
  })
  return release
}

describe('RequestAutomationPanel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads the settings the instance is actually running', async () => {
    await mountPanel()

    expect(apiMock).toHaveBeenCalledWith(PATH)
  })

  /** Unattended grabbing is off out of the box, so its knobs are not there to be fiddled with. */
  it('keeps the score floor out of the way until unattended grabbing is on', async () => {
    const wrapper = await mountPanel()

    expect(wrapper.text()).not.toContain('Minimum release score')

    const enabled = await mountPanel(settings({ autoGrabEnabled: true }))
    expect(enabled.text()).toContain('Minimum release score')
  })

  /**
   * The card header answers "what will this server do to my requests" without the reader having to
   * assemble it from four separate settings, so it has to track all of them.
   */
  describe('the summary each card leads with', () => {
    it('reports the picker is the only route while unattended grabbing is off', async () => {
      const wrapper = await mountPanel()

      expect(wrapper.text()).toContain('Every approved request waits for a person to open the release picker')
    })

    it('names the floor and how many releases will be tried', async () => {
      const wrapper = await mountPanel(settings({ autoGrabEnabled: true, autoRetryEnabled: true, maxAutoGrabAttempts: 3 }))

      expect(wrapper.text()).toContain('scores 80 or more')
      expect(wrapper.text()).toContain('Up to 3 releases are tried')
    })

    it('drops the retry clause when a failure is the end of it', async () => {
      const wrapper = await mountPanel(settings({ autoGrabEnabled: true, autoRetryEnabled: false }))

      expect(wrapper.text()).toContain('If it fails, the request waits for a person')
      expect(wrapper.text()).not.toContain('releases are tried')
    })

    /** Dragging is the moment the number means something, so the sentence cannot wait for the save. */
    it('follows the slider before anything is saved', async () => {
      const wrapper = await mountPanel(settings({ autoGrabEnabled: true }))
      apiMock.mockClear()

      // `setValue` fires the change the panel saves on; a drag in progress is only ever `input`.
      const slider = wrapper.get('#auto-grab-min-score')
      ;(slider.element as HTMLInputElement).value = '95'
      await slider.trigger('input')

      expect(wrapper.text()).toContain('scores 95 or more')
      expect(apiMock).not.toHaveBeenCalled()
    })
  })

  it('sends only the knob that moved', async () => {
    const wrapper = await mountPanel(settings({ autoGrabEnabled: true }))

    await wrapper.get('input[type="number"]').setValue(2)
    await wrapper.get('input[type="number"]').trigger('change')
    await flushPromises()

    expect(lastBody()).toEqual({ maxAutoGrabAttempts: 2 })
  })

  /** A cleared box is not an instruction to set the attempt limit to nothing. */
  it('puts an unusable attempt count back rather than posting it for a 400', async () => {
    const wrapper = await mountPanel(settings({ autoGrabEnabled: true }))
    apiMock.mockClear()

    // `setValue` on a number box already fires the change the component listens for.
    const box = wrapper.get('input[type="number"]')
    await box.setValue('')
    await flushPromises()

    expect(apiMock).not.toHaveBeenCalled()
    expect((box.element as HTMLInputElement).value).toBe(String(DEFAULT_BOOK_REQUEST_AUTOMATION_SETTINGS.maxAutoGrabAttempts))
  })

  /**
   * The wanted list. A request is looked for once when it is approved; without this one, a book
   * declined for want of a good enough release - or one whose first release is posted next month -
   * sits at approved forever looking like work somebody already took.
   */
  describe('keeping looking for requests nothing was found for', () => {
    it('stays out of the way until unattended grabbing is on', async () => {
      const wrapper = await mountPanel()

      expect(wrapper.text()).not.toContain('Keep looking')
    })

    it('holds its two knobs back until it is switched on', async () => {
      const wrapper = await mountPanel(settings({ autoGrabEnabled: true }))

      expect(wrapper.text()).toContain('Keep looking')
      expect(wrapper.find('#auto-search-interval').exists()).toBe(false)
      expect(wrapper.find('#auto-search-max-age').exists()).toBe(false)
    })

    it('shows the schedule the instance is running', async () => {
      const wrapper = await mountPanel(
        settings({ autoGrabEnabled: true, autoSearchEnabled: true, autoSearchIntervalHours: 12, autoSearchMaxAgeDays: 90 }),
      )

      expect((wrapper.get('#auto-search-interval').element as HTMLInputElement).value).toBe('12')
      expect((wrapper.get('#auto-search-max-age').element as HTMLInputElement).value).toBe('90')
    })

    it('sends only the knob that moved', async () => {
      const wrapper = await mountPanel(settings({ autoGrabEnabled: true, autoSearchEnabled: true }))
      apiMock.mockClear()

      await wrapper.get('#auto-search-interval').setValue('6')
      await flushPromises()

      expect(lastBody()).toEqual({ autoSearchIntervalHours: 6 })
    })

    /** A cleared box is not an instruction to search continuously, and the spinner does not clamp. */
    it.each([
      ['#auto-search-interval', '', String(DEFAULT_BOOK_REQUEST_AUTOMATION_SETTINGS.autoSearchIntervalHours)],
      ['#auto-search-interval', '0', String(DEFAULT_BOOK_REQUEST_AUTOMATION_SETTINGS.autoSearchIntervalHours)],
      ['#auto-search-max-age', '9000', String(DEFAULT_BOOK_REQUEST_AUTOMATION_SETTINGS.autoSearchMaxAgeDays)],
    ])('puts an unusable %s value back rather than posting it for a 400', async (selector, typed, restored) => {
      const wrapper = await mountPanel(settings({ autoGrabEnabled: true, autoSearchEnabled: true }))
      apiMock.mockClear()

      const box = wrapper.get(selector)
      await box.setValue(typed)
      await flushPromises()

      expect(apiMock).not.toHaveBeenCalled()
      expect((box.element as HTMLInputElement).value).toBe(restored)
    })
  })

  it('offers the verification threshold whether or not anything is automated', async () => {
    const wrapper = await mountPanel()

    expect(wrapper.text()).toContain('Verification threshold')
    expect((wrapper.get('#request-verification-threshold').element as HTMLInputElement).value).toBe('70')
  })

  /**
   * Off is the operator choosing to trust the grab, so the threshold it would have been measured
   * against is not a knob any more. It stays stored, and comes back with the number they tuned.
   */
  it('puts the threshold away when import checking is switched off', async () => {
    const wrapper = await mountPanel(settings({ verificationEnabled: false }))

    expect(wrapper.text()).not.toContain('Verification threshold')
    expect(wrapper.text()).toContain('Nothing is held for review')
  })

  it('sends the mode when the checking switch is thrown', async () => {
    const wrapper = await mountPanel()
    apiMock.mockResolvedValue(response(settings({ verificationEnabled: false })))

    const switches = wrapper.findAll('[role="switch"]')
    await switches[switches.length - 1].trigger('click')
    await flushPromises()

    expect(lastBody()).toEqual({ verificationEnabled: false })
  })

  it('adopts whatever the server reports back rather than what was typed', async () => {
    const wrapper = await mountPanel(settings({ autoGrabEnabled: true }))
    apiMock.mockResolvedValue(response(settings({ autoGrabEnabled: true, verificationThreshold: 85 })))

    const slider = wrapper.findAll('input[type="range"]').at(-1)!
    await slider.setValue(90)
    await slider.trigger('change')
    await flushPromises()

    expect((wrapper.get('#request-verification-threshold').element as HTMLInputElement).value).toBe('85')
  })

  /**
   * One shared saving flag used to disable all seventeen controls for the round trip, so moving
   * any one knob greyed out the whole panel and dropped focus to the document.
   */
  it('leaves every other control alone while a save is in flight', async () => {
    const wrapper = await mountPanel(settings({ autoGrabEnabled: true }))
    const before = disabledControls(wrapper)
    const release = heldSave(settings({ autoGrabEnabled: true }))

    await wrapper.findAll('[role="switch"]')[1]!.trigger('click')

    expect(disabledControls(wrapper)).toEqual(before)

    release()
    await flushPromises()
  })

  /** Refusing the second change lost it, and told the operator their save had failed. */
  it('queues a knob moved mid-save rather than reporting it failed', async () => {
    const wrapper = await mountPanel()
    apiMock.mockClear()
    const release = heldSave(settings({ verificationEnabled: false }))
    apiMock.mockResolvedValue(response(settings({ verificationEnabled: false, importFormats: 'preferred' })))

    const switches = wrapper.findAll('[role="switch"]')
    await switches[switches.length - 1]!.trigger('click')
    await wrapper.findAll('input[name="import-formats"]')[1]!.trigger('change')
    await flushPromises()

    expect(sentBodies()).toEqual([{ verificationEnabled: false }])

    release()
    await flushPromises()

    expect(sentBodies()).toEqual([{ verificationEnabled: false }, { importFormats: 'preferred' }])
    expect(toast.error).not.toHaveBeenCalled()
  })

  /**
   * A tier is described by clicking through a row of chips, selects and number boxes, and each of
   * those used to be its own PUT and its own "Saved" toast.
   */
  describe('release profiles', () => {
    async function profilePanel() {
      const wrapper = await mountPanel(
        settings({ profiles: { ebook: [{ id: 'tier-1', name: 'Retail', conditions: {} }], audiobook: [], comic: [] } }),
      )
      apiMock.mockClear()
      apiMock.mockResolvedValue(response(settings()))
      return wrapper
    }

    /** The chip presses land on the editor, and one request lands on the server. */
    it('collapses a burst of tier edits into one save', async () => {
      vi.useFakeTimers()
      try {
        const wrapper = await profilePanel()
        const chips = wrapper.findAll('button[aria-pressed]')

        await chips[0]!.trigger('click')
        await chips[1]!.trigger('click')
        await chips[2]!.trigger('click')
        expect(apiMock).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(1000)

        expect(apiMock).toHaveBeenCalledTimes(1)
        const profiles = lastBody().profiles as { ebook: { conditions: { formats: string[] } }[] }
        expect(profiles.ebook[0]!.conditions.formats).toHaveLength(3)
      } finally {
        vi.useRealTimers()
      }
    })

    it('says nothing on success, because the editor already shows the change', async () => {
      vi.useFakeTimers()
      try {
        const wrapper = await profilePanel()

        await wrapper.findAll('button[aria-pressed]')[0]!.trigger('click')
        await vi.advanceTimersByTimeAsync(1000)

        expect(toast.success).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })

    /** Both are evaluated by the matcher, and neither could be entered before. */
    it('stores a size ceiling in bytes from a figure typed in megabytes', async () => {
      vi.useFakeTimers()
      try {
        const wrapper = await profilePanel()
        const boxes = wrapper.findAll('input[type="number"]')

        await boxes[boxes.length - 1]!.setValue('700')
        await vi.advanceTimersByTimeAsync(1000)

        const profiles = lastBody().profiles as { ebook: { conditions: { maxSizeBytes: number } }[] }
        expect(profiles.ebook[0]!.conditions.maxSizeBytes).toBe(700 * 1024 * 1024)
      } finally {
        vi.useRealTimers()
      }
    })

    /**
     * Driven the way a person drives it, one pick at a time. The multi-selects this replaced passed
     * a `setValue([...])` that reached straight into `option.selected`, which is the one path a real
     * browser never takes: Vue stringified the bound array and the second pick cleared the box.
     */
    it('authors language and source conditions that the matcher already supports', async () => {
      vi.useFakeTimers()
      try {
        const wrapper = await profilePanel()

        async function pick(field: string, ...labels: string[]) {
          const input = wrapper.find(`input#tier-1-${field}`)
          for (const label of labels) {
            ;(input.element as HTMLInputElement).value = label
            await input.trigger('input')
            await input.trigger('keydown', { key: 'Enter' })
          }
        }

        await pick('languages', 'English', 'French')
        await pick('indexers', 'Public books', 'Private books')
        await vi.advanceTimersByTimeAsync(1000)

        const profiles = lastBody().profiles as {
          ebook: { conditions: { languages: string[]; indexerIds: number[] } }[]
        }
        expect(profiles.ebook[0]!.conditions.languages).toEqual(['en', 'fr'])
        expect(profiles.ebook[0]!.conditions.indexerIds).toEqual([11, 12])
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not let an unrelated save overwrite a profile waiting in the debounce window', async () => {
      vi.useFakeTimers()
      try {
        const wrapper = await profilePanel()
        const chip = wrapper.findAll('button[aria-pressed]')[0]!

        await chip.trigger('click')
        await wrapper.findAll('[role="switch"]').at(-1)!.trigger('click')
        await flushPromises()

        expect(chip.attributes('aria-pressed')).toBe('true')
      } finally {
        vi.useRealTimers()
      }
    })

    it('flushes the last profile edit when the settings panel is left before the timer fires', async () => {
      const wrapper = await profilePanel()

      await wrapper.findAll('button[aria-pressed]')[0]!.trigger('click')
      expect(apiMock).not.toHaveBeenCalled()
      wrapper.unmount()
      await flushPromises()

      expect(apiMock).toHaveBeenCalledTimes(1)
      expect(lastBody()).toHaveProperty('profiles.ebook')
    })
  })

  describe('import formats', () => {
    /**
     * Neither value is the "off" one, so a toggle would have to pick a side to be off. The default
     * is stated rather than implied by an unchecked box.
     */
    it('shows which format rule the instance is running', async () => {
      const wrapper = await mountPanel(settings({ importFormats: 'preferred' }))
      const radios = wrapper.findAll('input[name="import-formats"]')

      expect(radios).toHaveLength(2)
      expect((radios[1]!.element as HTMLInputElement).checked).toBe(true)
    })

    it('saves the rule the operator picked', async () => {
      const wrapper = await mountPanel()
      apiMock.mockResolvedValue(response(settings({ importFormats: 'preferred' })))

      await wrapper.findAll('input[name="import-formats"]')[1]!.trigger('change')
      await flushPromises()

      expect(lastBody()).toEqual({ importFormats: 'preferred' })
    })

    it('explains what each rule keeps', async () => {
      const text = (await mountPanel()).text()

      expect(text).toContain('All available')
      expect(text).toContain('Preferred only')
      expect(text).toContain("destination library's format priority")
    })
  })
})
