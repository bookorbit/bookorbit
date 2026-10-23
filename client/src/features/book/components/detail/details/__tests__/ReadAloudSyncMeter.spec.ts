import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ReadAloudSyncMeter from '../ReadAloudSyncMeter.vue'

function fills(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll('rect').map((rect) => ({ width: rect.attributes('width'), className: rect.attributes('class') }))
}

describe('ReadAloudSyncMeter', () => {
  it('fills both tracks to the same point and joins them with a marker when aligned', () => {
    const wrapper = mount(ReadAloudSyncMeter, { props: { aligned: true } })
    const [, , text, audio, marker] = fills(wrapper)

    expect(text!.width).toBe(audio!.width)
    expect(text!.className).toBe('fill-sync-meter-text')
    expect(audio!.className).toBe('fill-sync-meter-audio')
    expect(marker).toBeDefined()
  })

  it('offsets the tracks without a marker when positions are not shared', () => {
    const wrapper = mount(ReadAloudSyncMeter, { props: { aligned: false } })
    const rects = fills(wrapper)

    expect(rects).toHaveLength(4)
    expect(rects[2]!.width).not.toBe(rects[3]!.width)
  })

  it('draws both tracks in the muted colour when sync is off', () => {
    const wrapper = mount(ReadAloudSyncMeter, { props: { aligned: false, muted: true } })
    const [, , text, audio] = fills(wrapper)

    expect(text!.className).toBe('fill-muted-foreground')
    expect(audio!.className).toBe('fill-muted-foreground')
  })
})
