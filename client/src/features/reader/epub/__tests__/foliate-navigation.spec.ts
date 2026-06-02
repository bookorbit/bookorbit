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
    book: { sections: unknown[]; resolveHref: (href: string) => { index: number } }
    renderer: {
      goTo: (resolved: { index: number }) => Promise<void>
      getContents: () => { index: number; text?: string }[]
    }
    goTo: (target: string) => Promise<{ index: number } | undefined>
  }
  let Paginator: new () => {
    sections: { load: () => Promise<string | null> }[]
    goTo: (target: { index: number }) => Promise<void>
  }

  beforeAll(async () => {
    installBrowserGlobals()

    const viewModulePath = '../../../../../public/assets/foliate/view.js'
    const paginatorModulePath = '../../../../../public/assets/foliate/paginator.js'
    ;({ View } = (await import(viewModulePath)) as { View: typeof View })
    ;({ Paginator } = (await import(paginatorModulePath)) as { Paginator: typeof Paginator })
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
    expect(view.renderer.getContents()).toEqual([{ index: 2, text: 'chapter 2' }])
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

    expect(view.renderer.getContents()).toEqual([{ index: 1 }])
  })

  it('rejects paginator navigation when a section load does not produce a source', async () => {
    const paginator = new Paginator()
    paginator.sections = [{ load: vi.fn<() => Promise<string | null>>().mockResolvedValue(null) }]

    await expect(paginator.goTo({ index: 0 })).rejects.toThrow('Failed to load section 0')
  })
})
