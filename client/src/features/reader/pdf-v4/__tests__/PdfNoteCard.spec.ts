import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { AnnotationItem } from '@bookorbit/types'
import PdfNoteCard from '../components/PdfNoteCard.vue'

function makeAnnotation(overrides: Partial<AnnotationItem> = {}): AnnotationItem {
  return {
    id: 1,
    bookId: 5,
    cfi: null,
    jumpFileId: 9,
    pageno: null,
    text: 'highlighted words',
    color: '#FACC15',
    style: 'highlight',
    note: null,
    chapterTitle: null,
    origin: 'web',
    positionStatus: 'exact',
    chapterIndex: null,
    highlightedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    pdf: { page: 8, rect: { x: 1, y: 2, width: 3, height: 4 }, rects: [{ x: 1, y: 2, width: 3, height: 4 }] },
    ...overrides,
  }
}

describe('PdfNoteCard', () => {
  it('shows the highlighted text', () => {
    const wrapper = mount(PdfNoteCard, { props: { annotation: makeAnnotation() } })
    expect(wrapper.text()).toContain('highlighted words')
    expect(wrapper.text()).not.toContain('Text not available for this highlight')
  })

  it('shows a placeholder for a highlight saved without text', () => {
    const wrapper = mount(PdfNoteCard, { props: { annotation: makeAnnotation({ text: '' }) } })
    expect(wrapper.text()).toContain('Text not available for this highlight')
  })
})
