import { beforeAll, describe, expect, it, vi } from 'vitest'

function installBrowserGlobals() {
  Object.assign(globalThis, {
    EventTarget: window.EventTarget,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    Node: window.Node,
    NodeFilter: window.NodeFilter,
    Range: window.Range,
    DOMRect: window.DOMRect,
    CSS: window.CSS,
  })

  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.requestAnimationFrame ??= (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0)
  globalThis.matchMedia ??= () =>
    ({
      matches: false,
      addEventListener: vi.fn<() => void>(),
      removeEventListener: vi.fn<() => void>(),
    }) as unknown as MediaQueryList
}

describe('Foliate navigation', () => {
  let View: new () => {
    book: { sections?: unknown[]; resolveHref?: (href: string) => { index: number }; dir?: string | null }
    renderer: {
      goTo?: (resolved: { index: number }) => Promise<void>
      getContents?: () => { index: number; text?: string }[]
      prev?: () => void
      next?: () => void
      getAttribute?: (name: string) => string | null
    }
    goTo: (target: string) => Promise<{ index: number } | undefined>
    goLeft: () => Promise<void>
    goRight: () => Promise<void>
  }
  let getKoreaderProgress: (index: number, range: Range | null) => string | null
  let getKoreaderDocFragmentIndex: (sections: { id: string }[], index: number) => number | null
  let getKoboSpanValue: (range: Range | null) => string | null
  let getPageProgressionRtl: (bookDir: string | null | undefined, contentRtl: boolean) => boolean
  let usesNegativePageScroll: (vertical: boolean, pageProgressionRtl: boolean) => boolean
  let getPageScrollOffset: (page: number, size: number, vertical: boolean, pageProgressionRtl: boolean) => number
  let normalizeStylesheetForReader: (data: string, width?: number, height?: number) => string
  let FixedLayout: new () => HTMLElement & {
    open: (book: { rendition: { layout: string; spread: string }; sections: { load: () => Promise<string> }[] }) => void
    goTo: (target: { index: number }) => Promise<void>
    getContents: () => { index?: number; doc?: Document }[]
  }
  let Paginator: new () => {
    sections: { load: () => Promise<string | null> }[]
    goTo: (target: { index: number }) => Promise<void>
  }

  beforeAll(async () => {
    installBrowserGlobals()

    const viewModulePath = '../../../../../public/assets/foliate/view.js'
    const fixedLayoutModulePath = '../../../../../public/assets/foliate/fixed-layout.js'
    const paginatorModulePath = '../../../../../public/assets/foliate/paginator.js'
    ;({ View, getKoreaderProgress, getKoreaderDocFragmentIndex, getKoboSpanValue } = (await import(viewModulePath)) as {
      View: typeof View
      getKoreaderProgress: typeof getKoreaderProgress
      getKoreaderDocFragmentIndex: typeof getKoreaderDocFragmentIndex
      getKoboSpanValue: typeof getKoboSpanValue
    })
    ;({ FixedLayout } = (await import(fixedLayoutModulePath)) as { FixedLayout: typeof FixedLayout })
    ;({ Paginator, getPageProgressionRtl, usesNegativePageScroll, getPageScrollOffset, normalizeStylesheetForReader } = (await import(
      paginatorModulePath
    )) as {
      Paginator: typeof Paginator
      getPageProgressionRtl: typeof getPageProgressionRtl
      usesNegativePageScroll: typeof usesNegativePageScroll
      getPageScrollOffset: typeof getPageScrollOffset
      normalizeStylesheetForReader: typeof normalizeStylesheetForReader
    })
  })

  it('does not treat stale rendered contents as successful navigation', async () => {
    const view = new View()
    let renderedIndex = 0
    const goToCalls: { index: number }[] = []

    view.book = {
      sections: [{}, {}, {}],
      resolveHref: (href: string) => ({ index: Number(href.replace('chapter-', '')) }),
    }
    view.renderer = {
      async goTo(resolved: { index: number }) {
        goToCalls.push(resolved)
        if (resolved.index === 2) renderedIndex = 2
      },
      getContents: () => [{ index: renderedIndex, text: `chapter ${renderedIndex}` }],
    }

    await expect(view.goTo('chapter-1')).resolves.toEqual({ index: 2 })

    expect(goToCalls).toEqual([{ index: 1 }, { index: 2 }])
    expect(view.renderer!.getContents!()).toEqual([{ index: 2, text: 'chapter 2' }])
  })

  it('keeps the requested target when the rendered contents match', async () => {
    const view = new View()
    let renderedIndex = 0

    view.book = {
      sections: [{}, {}, {}],
      resolveHref: (href: string) => ({ index: Number(href.replace('chapter-', '')) }),
    }
    view.renderer = {
      async goTo(resolved: { index: number }) {
        renderedIndex = resolved.index
      },
      getContents: () => [{ index: renderedIndex }],
    }

    await expect(view.goTo('chapter-1')).resolves.toEqual({ index: 1 })

    expect(view.renderer!.getContents!()).toEqual([{ index: 1 }])
  })

  it('rejects paginator navigation when a section load does not produce a source', async () => {
    const paginator = new Paginator()
    paginator.sections = [{ load: vi.fn<() => Promise<string | null>>().mockResolvedValue(null) }]

    await expect(paginator.goTo({ index: 0 })).rejects.toThrow('Failed to load section 0')
  })

  it('reports fixed-layout frame indexes for navigation success checks', async () => {
    const originalCreateElement = document.createElement.bind(document)
    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName)
      if (tagName === 'iframe') {
        const frameDoc = document.implementation.createHTMLDocument('fixed-layout-frame')
        frameDoc.head.innerHTML = '<meta name="viewport" content="width=100,height=200">'
        Object.defineProperty(element, 'contentDocument', { configurable: true, value: frameDoc })
        Object.defineProperty(element, 'src', {
          configurable: true,
          get() {
            return this.getAttribute('src') ?? ''
          },
          set(value) {
            this.setAttribute('src', value)
            queueMicrotask(() => this.dispatchEvent(new window.Event('load')))
          },
        })
      }
      return element
    })

    const fixedLayout = new FixedLayout()
    document.body.append(fixedLayout)

    try {
      fixedLayout.open({
        rendition: { layout: 'pre-paginated', spread: 'none' },
        sections: [
          { load: vi.fn<() => Promise<string>>().mockResolvedValue('section-0.xhtml') },
          { load: vi.fn<() => Promise<string>>().mockResolvedValue('section-1.xhtml') },
        ],
      })

      await fixedLayout.goTo({ index: 0 })

      const contents = fixedLayout.getContents()
      expect(contents).toHaveLength(1)
      expect(contents[0]).toMatchObject({ index: 0 })
      expect(contents[0]?.doc?.documentElement).toBeTruthy()
    } finally {
      fixedLayout.remove()
      createElementSpy.mockRestore()
    }
  })

  it('uses explicit OPF page progression before content direction', () => {
    expect(getPageProgressionRtl('rtl', false)).toBe(true)
    expect(getPageProgressionRtl('ltr', true)).toBe(false)
    expect(getPageProgressionRtl('default', true)).toBe(true)
    expect(getPageProgressionRtl(undefined, false)).toBe(false)
  })

  it('normalizes legacy vertical writing CSS used by Japanese EPUBs', () => {
    const css = `
      .vrtl {
        -webkit-writing-mode: vertical-rl;
        -epub-text-orientation: upright;
        -webkit-line-break: strict;
      }
      .page {
        width: 50vw;
        height: 25vh;
        page-break-after: always;
      }
    `

    const normalized = normalizeStylesheetForReader(css, 1200, 800)

    expect(normalized).toContain('writing-mode: vertical-rl;')
    expect(normalized).toContain('text-orientation: upright;')
    expect(normalized).toContain('line-break: strict;')
    expect(normalized).toContain('width: 600px;')
    expect(normalized).toContain('height: 200px;')
    expect(normalized).toContain('-webkit-column-break-after: always;')
    expect(normalized).not.toContain('-webkit-writing-mode')
    expect(normalized).not.toContain('-epub-text-orientation')
    expect(normalized).not.toContain('-webkit-line-break')
  })

  it('uses positive page scroll offsets for vertical RTL paginated EPUBs', () => {
    expect(usesNegativePageScroll(false, true)).toBe(true)
    expect(usesNegativePageScroll(true, true)).toBe(false)
    expect(getPageScrollOffset(1, 800, false, true)).toBe(-800)
    expect(getPageScrollOffset(1, 800, true, true)).toBe(800)
    expect(getPageScrollOffset(1, 800, true, false)).toBe(800)
  })

  it('maps physical left and right navigation using OPF RTL page progression', async () => {
    const view = new View()
    const prev = vi.fn<() => void>()
    const next = vi.fn<() => void>()

    view.book = { dir: 'rtl' }
    view.renderer = { prev, next, getAttribute: () => null }

    await view.goLeft()
    await view.goRight()

    expect(next).toHaveBeenCalledTimes(1)
    expect(prev).toHaveBeenCalledTimes(1)
  })

  it('maps physical left and right navigation using renderer-resolved RTL direction', async () => {
    const view = new View()
    const prev = vi.fn<() => void>()
    const next = vi.fn<() => void>()

    view.book = { dir: null }
    view.renderer = {
      prev,
      next,
      getAttribute: (name: string) => (name === 'dir' ? 'rtl' : null),
    }

    await view.goLeft()
    await view.goRight()

    expect(next).toHaveBeenCalledTimes(1)
    expect(prev).toHaveBeenCalledTimes(1)
  })

  it('preserves real inline elements for KOReader XPointer progress', () => {
    const doc = document.implementation.createHTMLDocument('chapter')
    doc.body.innerHTML = '<p>First paragraph</p><p><span>Middle text</span> tail</p>'

    const text = doc.querySelector('p:nth-of-type(2) span')?.firstChild
    if (!text) throw new Error('Expected text node')

    const range = doc.createRange()
    range.setStart(text, 2)
    range.setEnd(text, 8)

    expect(getKoreaderProgress(8, range)).toBe('/body/DocFragment[8]/body/p[2]/span/text().2')
  })

  it('uses the text endpoint and strips Foliate layout wrappers when the range starts on a container', () => {
    const doc = document.implementation.createHTMLDocument('chapter')
    doc.body.innerHTML =
      '<div id="book-columns"><div id="book-inner"><div id="filepos48449"></div><p><span id="kobo.10.6">Middle text</span></p></div></div>'

    const start = doc.querySelector('#filepos48449')
    const text = doc.querySelector('#kobo\\.10\\.6')?.firstChild
    if (!start || !text) throw new Error('Expected test nodes')

    const range = doc.createRange()
    range.setStart(start, 0)
    range.setEnd(text, 6)

    expect(getKoreaderProgress(7, range)).toBe('/body/DocFragment[7]/body/p/span/text().6')
  })

  it('merges adjacent KoboSpan text wrappers for KOReader text node offsets', () => {
    const doc = document.implementation.createHTMLDocument('chapter')
    doc.body.innerHTML =
      '<p><span class="koboSpan" id="kobo.5.1">“</span><span class="italic"><span class="koboSpan" id="kobo.5.2">Fascinating</span></span><span class="koboSpan" id="kobo.5.3">!” </span><span class="koboSpan" id="kobo.5.4">he would say as Harry talked him through using a telephone. </span><span class="koboSpan" id="kobo.5.5">“</span><span class="italic"><span class="koboSpan" id="kobo.5.6">Ingenious,</span></span><span class="koboSpan" id="kobo.5.7"> really, how many ways Muggles have found of getting along without magic.”</span></p>'

    const text = doc.querySelector('#kobo\\.5\\.4')?.firstChild
    if (!text) throw new Error('Expected text node')

    const range = doc.createRange()
    range.setStart(text, 33)
    range.setEnd(text, 33)

    expect(getKoreaderProgress(8, range)).toBe('/body/DocFragment[8]/body/p/text()[2].36')
  })

  it('uses the KoboSpan-local offset inside the original EPUB text node', () => {
    const doc = document.implementation.createHTMLDocument('chapter')
    doc.body.innerHTML =
      '<p><span class="italic"><span class="koboSpan" id="kobo.13.1">Gadding with Ghouls</span></span><span class="koboSpan" id="kobo.13.2"> by Gilderoy Lockhart</span></p>'

    const text = doc.querySelector('#kobo\\.13\\.2')?.firstChild
    if (!text) throw new Error('Expected text node')

    const range = doc.createRange()
    range.setStart(text, 21)
    range.setEnd(text, 21)

    expect(getKoreaderProgress(8, range)).toBe('/body/DocFragment[8]/body/p/text().21')
  })

  it('maps KEPUB sections back to KOReader DocFragment indexes', () => {
    const sections = [
      { id: 'kepubify-titlepage-dummy.xhtml' },
      { id: 'text/part0000_split_000.html' },
      { id: 'text/part0000_split_000.html' },
      { id: 'text/part0000_split_001.html' },
      { id: 'text/part0001.html' },
      { id: 'text/part0002.html' },
      { id: 'text/part0003.html' },
      { id: 'text/part0004.html' },
      { id: 'text/part0005.html' },
      { id: 'text/part0006.html' },
      { id: 'text/part0007.html' },
      { id: 'text/part0008.html' },
      { id: 'text/part0009.html' },
      { id: 'text/part0010.html' },
      { id: 'text/part0011.html' },
      { id: 'text/part0012.html' },
      { id: 'text/part0013.html' },
      { id: 'text/part0014.html' },
      { id: 'text/part0015.html' },
      { id: 'text/part0016.html' },
    ]

    expect(getKoreaderDocFragmentIndex(sections, 0)).toBeNull()
    expect(getKoreaderDocFragmentIndex(sections, 1)).toBe(1)
    expect(getKoreaderDocFragmentIndex(sections, 2)).toBe(2)
    expect(getKoreaderDocFragmentIndex(sections, 19)).toBe(19)
  })

  it('uses the selected text point for KoboSpan instead of the first span in a wide range', () => {
    const doc = document.implementation.createHTMLDocument('chapter')
    doc.body.innerHTML =
      '<div id="filepos48449"></div><p><span class="koboSpan" id="kobo.1.1">Start</span></p><p><span class="koboSpan" id="kobo.10.6">Middle text</span></p>'

    const start = doc.querySelector('#filepos48449')
    const text = doc.querySelector('#kobo\\.10\\.6')?.firstChild
    if (!start || !text) throw new Error('Expected test nodes')

    const range = doc.createRange()
    range.setStart(start, 0)
    range.setEnd(text, 6)

    expect(getKoboSpanValue(range)).toBe('kobo.10.6')
  })
})
