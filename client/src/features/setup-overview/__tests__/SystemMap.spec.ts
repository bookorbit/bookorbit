import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { SetupMap } from '@bookorbit/types'

import SystemMap from '../components/SystemMap.vue'

const MAP: SetupMap = {
  lanes: [
    {
      id: 'dropped',
      caption: { key: 'setupOverview.ingest.map.dropped' },
      entries: [{ id: 'upload', icon: 'upload', label: { key: 'setupOverview.ingest.map.upload' }, sub: null }],
      stations: [
        {
          id: 'dock-files',
          icon: 'check',
          label: { key: 'setupOverview.ingest.steps.files' },
          sub: { key: 'setupOverview.ingest.edges.threshold', values: { percent: 85 } },
        },
      ],
      into: null,
      note: null,
      branch: null,
    },
  ],
  library: {
    label: { key: 'setupOverview.ingest.map.library' },
    sub: { key: 'setupOverview.ingest.map.books', values: { count: 1059 } },
    foot: { key: 'setupOverview.ingest.map.libraries', values: { count: 6 } },
  },
  out: [
    {
      id: 'kobo',
      icon: 'folder-sync',
      label: { key: 'setupOverview.out.steps.kobo' },
      sub: { key: 'setupOverview.out.lines.koboA', values: { count: 1 } },
    },
  ],
  services: [
    {
      id: 'ai',
      icon: 'sparkles',
      label: { key: 'setupOverview.ai.map.service' },
      sub: { key: 'setupOverview.ai.map.serviceBudget', values: { count: 2, amount: 25 }, money: ['amount'] },
      asks: null,
    },
  ],
}

describe('SystemMap', () => {
  it('draws every lane, the library and where books go, in words as well as shapes', () => {
    const text = mount(SystemMap, { props: { map: MAP, needYou: 0 } }).text()
    expect(text).toContain('DROPPED IN')
    expect(text).toContain('Files itself')
    expect(text).toContain('at 85%')
    expect(text).toContain('Your library')
    expect(text).toContain('1,059 books')
    expect(text).toContain('6 libraries')
    expect(text).toContain('1 device')
  })

  it('formats an amount the server marked as money as currency', () => {
    expect(mount(SystemMap, { props: { map: MAP, needYou: 0 } }).text()).toContain('2 connections, up to $25 a month')
  })

  it('says how many things need a person, and says so when none do', () => {
    expect(mount(SystemMap, { props: { map: MAP, needYou: 3 } }).text()).toContain('3 need you')
    expect(mount(SystemMap, { props: { map: MAP, needYou: 1 } }).text()).toContain('1 needs you')
    expect(mount(SystemMap, { props: { map: MAP, needYou: 0 } }).text()).toContain('Nothing needs you')
  })

  it('gives the drawing one label for assistive technology', () => {
    const svg = mount(SystemMap, { props: { map: MAP, needYou: 0 } }).find('svg[role="img"]')
    expect(svg.attributes('aria-label')).toMatch(/map of every flow/i)
  })
})
