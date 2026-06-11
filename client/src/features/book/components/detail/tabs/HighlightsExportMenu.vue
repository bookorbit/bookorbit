<script setup lang="ts">
import { ref } from 'vue'
import { Download, FileText, FileJson, FileType } from '@lucide/vue'
import type { AnnotationItem } from '@bookorbit/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const props = withDefaults(
  defineProps<{
    items: AnnotationItem[]
    bookTitle: string
    label?: string
  }>(),
  { label: 'Export' },
)

const open = ref(false)

function closeMenu() {
  open.value = false
}

function groupByChapter(items: AnnotationItem[]) {
  const groups = new Map<string, AnnotationItem[]>()
  for (const item of items) {
    const key = item.chapterTitle ?? 'Uncategorized'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(item)
  }
  return groups
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function exportMarkdown() {
  const groups = groupByChapter(props.items)
  let md = `# ${props.bookTitle} - Highlights\n\n`
  for (const [chapter, highlights] of groups) {
    md += `## ${chapter}\n\n`
    for (const h of highlights) {
      md += `> ${h.text}\n\n`
      if (h.note) md += `**Note:** ${h.note}\n\n`
      md += `---\n\n`
    }
  }
  const safeName = props.bookTitle
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
  downloadFile(md, `${safeName}-highlights.md`, 'text/markdown')
  closeMenu()
}

function exportPlainText() {
  const groups = groupByChapter(props.items)
  let text = `${props.bookTitle} - Highlights\n${'='.repeat(40)}\n\n`
  for (const [chapter, highlights] of groups) {
    text += `${chapter}\n${'-'.repeat(chapter.length)}\n\n`
    for (const h of highlights) {
      text += `"${h.text}"\n`
      if (h.note) text += `Note: ${h.note}\n`
      text += `\n`
    }
  }
  const safeName = props.bookTitle
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
  downloadFile(text, `${safeName}-highlights.txt`, 'text/plain')
  closeMenu()
}

function exportJson() {
  const data = {
    bookTitle: props.bookTitle,
    exportedAt: new Date().toISOString(),
    totalHighlights: props.items.length,
    highlights: props.items.map((h) => ({
      text: h.text,
      note: h.note,
      color: h.color,
      style: h.style,
      chapter: h.chapterTitle,
      createdAt: h.createdAt,
    })),
  }
  const safeName = props.bookTitle
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
  downloadFile(JSON.stringify(data, null, 2), `${safeName}-highlights.json`, 'application/json')
  closeMenu()
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <button
        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        :disabled="items.length === 0"
      >
        <Download :size="14" />
        {{ label }}
      </button>
    </PopoverTrigger>
    <PopoverContent align="end" class="w-44 p-1">
      <button
        class="flex items-center gap-2 w-full px-3 py-2 rounded text-sm text-foreground hover:bg-muted transition-colors"
        @click="exportMarkdown"
      >
        <FileText :size="14" class="text-muted-foreground" />
        Markdown
      </button>
      <button
        class="flex items-center gap-2 w-full px-3 py-2 rounded text-sm text-foreground hover:bg-muted transition-colors"
        @click="exportPlainText"
      >
        <FileType :size="14" class="text-muted-foreground" />
        Plain Text
      </button>
      <button class="flex items-center gap-2 w-full px-3 py-2 rounded text-sm text-foreground hover:bg-muted transition-colors" @click="exportJson">
        <FileJson :size="14" class="text-muted-foreground" />
        JSON
      </button>
    </PopoverContent>
  </Popover>
</template>
