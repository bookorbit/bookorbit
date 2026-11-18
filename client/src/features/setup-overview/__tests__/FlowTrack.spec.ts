import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { SetupBranch, SetupStep } from '@bookorbit/types'

import FlowTrack from '../components/FlowTrack.vue'

const STEPS: SetupStep[] = [
  {
    id: 'arrives',
    icon: 'upload',
    label: { key: 'setupOverview.ingest.steps.arrives' },
    lines: [],
    edge: { key: 'setupOverview.ingest.edges.docks', values: { count: 3 } },
  },
  {
    id: 'matched',
    icon: 'search',
    label: { key: 'setupOverview.ingest.steps.matched' },
    lines: [],
    edge: { key: 'setupOverview.ingest.edges.threshold', values: { percent: 85 } },
  },
  { id: 'library', icon: 'library', label: { key: 'setupOverview.ingest.steps.library' }, lines: [], edge: null, terminal: true },
]

function render(branch: SetupBranch | null = null, steps = STEPS) {
  return mount(FlowTrack, { props: { flow: 'ingest' as const, steps, branch, label: 'Books coming in' } })
}

describe('FlowTrack', () => {
  it('names every step in text, so colour is never the only carrier', () => {
    const text = render().text()
    expect(text).toContain('Arrives')
    expect(text).toContain('Matched')
    expect(text).toContain('In the library')
  })

  it('puts the configured value on the wire', () => {
    expect(render().text()).toContain('at 85%')
    expect(render().text()).toContain('3 docks')
  })

  it('gives the whole drawing one label for assistive technology', () => {
    expect(render().find('svg[role="img"]').attributes('aria-label')).toBe('Books coming in')
  })

  it('draws where a book lands in the landed colour, whatever the flow wears', () => {
    const circles = render().findAll('svg').at(0)?.findAll('circle') ?? []
    const strokes = circles.map((c) => c.attributes('stroke'))
    expect(strokes.some((s) => s?.includes('pill-source-green'))).toBe(true)
    expect(strokes.some((s) => s?.includes('pill-source-blue'))).toBe(true)
  })

  it('draws the branch only when there is one', () => {
    expect(render().text()).not.toContain('On hold')
    const branch: SetupBranch = {
      at: 'matched',
      back: 'library',
      label: { key: 'setupOverview.ingest.branch.onHold' },
      sub: { key: 'setupOverview.ingest.branch.waiting', values: { count: 2 } },
    }
    const text = render(branch).text()
    expect(text).toContain('On hold')
    expect(text).toContain('2 waiting now')
  })

  it('starts the branch below the labels, so its dashed line never crosses text', () => {
    const branch: SetupBranch = { at: 'matched', back: 'library', label: { key: 'setupOverview.ingest.branch.onHold' }, sub: null }
    const dashed = render(branch)
      .findAll('path')
      .filter((p) => p.attributes('stroke-dasharray') === '4 4')
    expect(dashed).toHaveLength(2)
    // Labels sit at y 92 and lines from 110; the branch leaves from beneath them.
    const startY = Number(dashed[0]!.attributes('d')!.split(' ')[2])
    expect(startY).toBeGreaterThan(100)
  })

  it('reads a message this build does not know as words rather than as a blank', () => {
    const steps: SetupStep[] = [{ ...STEPS[0], label: { key: 'setupOverview.ingest.steps.somethingNewer' }, edge: null }]
    expect(render(null, steps).text()).toContain('Something newer')
  })

  it('passes names people wrote through untranslated', () => {
    const steps: SetupStep[] = [{ ...STEPS[0], label: { key: 'raw', values: { text: 'Fiction' } }, edge: null }]
    expect(render(null, steps).text()).toContain('Fiction')
  })
})

describe('the icon map', () => {
  it('holds every glyph the server can name, so no node loses its icon', async () => {
    const { setupIcon } = await import('../lib/icons')
    // Kept in step with the `icon:` values in the server's setup-flow contributors.
    const named = [
      'book-open',
      'bot',
      'check',
      'check-check',
      'download',
      'file-text',
      'folder-input',
      'folder-search',
      'folder-sync',
      'git-merge',
      'inbox',
      'library',
      'list-checks',
      'mail',
      'package-open',
      'rotate-cw',
      'rss',
      'search',
      'send',
      'sliders-horizontal',
      'sparkles',
      'tablet',
      'tag',
      'upload',
    ]
    expect(named.filter((name) => setupIcon(name) === null)).toEqual([])
  })

  it('draws nothing rather than failing for a glyph this build does not bundle', async () => {
    const { setupIcon } = await import('../lib/icons')
    expect(setupIcon('a-glyph-from-a-newer-server')).toBeNull()
  })
})
