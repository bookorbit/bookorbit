import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// @ts-expect-error public Foliate asset has no TypeScript declarations.
import { EPUB } from '../../../../../public/assets/foliate/epub.js'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = []

  readonly src: string
  paused = true
  currentTime = 0
  volume = 1
  playbackRate = 1
  playCalls = 0

  constructor(src: string) {
    super()
    this.src = src
    FakeAudio.instances.push(this)
  }

  play(): Promise<void> {
    this.playCalls++
    this.paused = false
    this.dispatchEvent(new Event('playing'))
    return Promise.resolve()
  }

  pause(): void {
    this.paused = true
  }

  emitCanPlayThrough(): void {
    this.dispatchEvent(new Event('canplaythrough'))
  }
}

const smil = `<?xml version="1.0"?>
<smil xmlns="http://www.w3.org/ns/SMIL">
  <body><seq>
    <par><text src="chapter.xhtml#top"/><audio src="audio.mp3" clipBegin="0" clipEnd="1"/></par>
    <par><text src="chapter.xhtml#selected"/><audio src="audio.mp3" clipBegin="1" clipEnd="2"/></par>
  </seq></body>
</smil>`

function makeOverlay(loadBlob: (src: string) => Promise<Blob>) {
  const book = new EPUB({
    loadText: async (src: string) => (src === 'OPS/chapter.smil' ? smil : null),
    loadBlob,
    getSize: () => 0,
  })
  book.sections = [
    {
      id: 'OPS/chapter.xhtml',
      mediaOverlay: { href: 'OPS/chapter.smil' },
    },
  ]
  return book.getMediaOverlay()
}

describe('Foliate MediaOverlay concurrency', () => {
  const originalAudio = globalThis.Audio
  const originalCreateObjectURL = URL.createObjectURL
  const originalRevokeObjectURL = URL.revokeObjectURL

  beforeEach(() => {
    FakeAudio.instances = []
    globalThis.Audio = FakeAudio as unknown as typeof Audio
    URL.createObjectURL = vi.fn<(object: Blob | MediaSource) => string>(() => 'blob:media-overlay')
    URL.revokeObjectURL = vi.fn<(url: string) => void>()
  })

  afterEach(() => {
    globalThis.Audio = originalAudio
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
    vi.restoreAllMocks()
  })

  it('reports whether the requested SMIL entry exists', async () => {
    const loadBlob = vi.fn<(src: string) => Promise<Blob>>().mockResolvedValue(new Blob(['audio']))
    const overlay = makeOverlay(loadBlob)

    await expect(overlay.start(0, (item: { text: string }) => item.text.endsWith('#selected'))).resolves.toBe(true)
    await expect(overlay.start(0, (item: { text: string }) => item.text.endsWith('#missing'))).resolves.toBe(false)

    expect(loadBlob).toHaveBeenCalledOnce()
    overlay.stop()
  })

  it('discards an in-flight audio load when a newer start supersedes it', async () => {
    const loads: Deferred<Blob>[] = []
    const loadBlob = vi.fn<(src: string) => Promise<Blob>>(() => {
      const load = deferred<Blob>()
      loads.push(load)
      return load.promise
    })
    const overlay = makeOverlay(loadBlob)
    const highlights: string[] = []
    overlay.addEventListener('highlight', (event: Event) => highlights.push((event as CustomEvent<{ text: string }>).detail.text))

    const selectedStart = overlay.start(0, (item: { text: string }) => item.text.endsWith('#selected'))
    await vi.waitFor(() => expect(loads).toHaveLength(1))
    const fallbackStart = overlay.start(0)
    await vi.waitFor(() => expect(loads).toHaveLength(2))

    loads[0]!.resolve(new Blob(['selected audio']))
    await selectedStart
    expect(FakeAudio.instances).toHaveLength(0)

    loads[1]!.resolve(new Blob(['fallback audio']))
    await fallbackStart
    expect(FakeAudio.instances).toHaveLength(1)

    FakeAudio.instances[0]!.emitCanPlayThrough()
    expect(highlights).toEqual(['OPS/chapter.xhtml#top'])

    overlay.stop()
    expect(FakeAudio.instances[0]!.paused).toBe(true)
  })

  it('does not create audio when playback stops during a blob load', async () => {
    const load = deferred<Blob>()
    const loadBlob = vi.fn<(src: string) => Promise<Blob>>(() => load.promise)
    const overlay = makeOverlay(loadBlob)

    const start = overlay.start(0)
    await vi.waitFor(() => expect(loadBlob).toHaveBeenCalledOnce())
    overlay.stop()
    load.resolve(new Blob(['audio']))
    await start

    expect(FakeAudio.instances).toHaveLength(0)
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('ignores a late canplaythrough event after playback stops', async () => {
    const overlay = makeOverlay(async () => new Blob(['audio']))

    await overlay.start(0)
    const audio = FakeAudio.instances[0]!
    overlay.stop()
    audio.emitCanPlayThrough()

    expect(audio.playCalls).toBe(0)
    expect(audio.paused).toBe(true)
  })
})
