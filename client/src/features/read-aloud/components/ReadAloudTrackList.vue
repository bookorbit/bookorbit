<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp } from '@lucide/vue'
import type { ReadAloudCandidateFile } from '@bookorbit/types'
import { formatReadAloudDuration } from '../lib/read-aloud'

/**
 * The tracks in listening order. Rows really move when reordered, a skipped track keeps its place
 * so ticking it again puts it back where it was, and the keyboard stays on the row that moved.
 */
const props = defineProps<{ tracks: ReadAloudCandidateFile[] }>()
const order = defineModel<number[]>('order', { required: true })
const skipped = defineModel<number[]>('skipped', { required: true })

const { t } = useI18n()
const listId = useId()
const announcement = ref('')
const moveButtons = new Map<string, HTMLButtonElement>()

const tracksById = computed(() => new Map(props.tracks.map((track) => [track.id, track])))
const skippedIds = computed(() => new Set(skipped.value))
const rows = computed(() =>
  order.value.flatMap((id, index) => {
    const track = tracksById.value.get(id)
    if (!track) return []
    return [
      {
        id,
        name: track.filename,
        position: index + 1,
        skipped: skippedIds.value.has(id),
        duration: track.durationSeconds != null ? formatReadAloudDuration(track.durationSeconds, t) : null,
      },
    ]
  }),
)
const total = computed(() => rows.value.length)

function setMoveButton(id: number, direction: 'up' | 'down', element: unknown): void {
  const key = `${id}:${direction}`
  if (element instanceof HTMLButtonElement) moveButtons.set(key, element)
  else moveButtons.delete(key)
}

function toggleTrack(id: number): void {
  skipped.value = skippedIds.value.has(id) ? skipped.value.filter((value) => value !== id) : [...skipped.value, id]
}

async function moveTrack(id: number, direction: -1 | 1): Promise<void> {
  const index = order.value.indexOf(id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= order.value.length) return
  const next = [...order.value]
  next[index] = next[target]!
  next[target] = id
  order.value = next

  const name = tracksById.value.get(id)?.filename ?? ''
  announcement.value = t('book.detail.files.readAloud.dialog.moved', { name, position: target + 1, total: next.length })

  await nextTick()
  // At an end the pressed button has nothing left to do, so the keyboard moves to the one that does.
  const atTop = target === 0
  const atBottom = target === next.length - 1
  let focusDirection: 'up' | 'down' = direction < 0 ? 'up' : 'down'
  if (focusDirection === 'up' && atTop && !atBottom) focusDirection = 'down'
  if (focusDirection === 'down' && atBottom && !atTop) focusDirection = 'up'
  moveButtons.get(`${id}:${focusDirection}`)?.focus()
}
</script>

<template>
  <div>
    <ol :id="listId" class="max-h-72 overflow-y-auto rounded-lg border border-border" :aria-label="t('book.detail.files.readAloud.dialog.trackList')">
      <li
        v-for="row in rows"
        :key="row.id"
        class="flex min-h-11 items-center gap-2 border-b border-border px-2.5 py-1.5 last:border-b-0"
        :data-track-id="row.id"
      >
        <span class="w-6 shrink-0 text-end text-[12px] tabular-nums text-muted-foreground" aria-hidden="true">{{ row.position }}</span>
        <input
          :id="`${listId}-${row.id}`"
          type="checkbox"
          class="size-4 shrink-0 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :checked="!row.skipped"
          :aria-label="t('book.detail.files.readAloud.dialog.trackLabel', { position: row.position, total, name: row.name })"
          @change="toggleTrack(row.id)"
        />
        <label
          :for="`${listId}-${row.id}`"
          class="min-w-0 flex-1 cursor-pointer truncate text-[13px]"
          :class="row.skipped ? 'text-muted-foreground' : 'text-foreground'"
          :title="row.name"
        >
          {{ row.name }}
        </label>
        <span v-if="row.skipped" class="shrink-0 text-[11.5px] text-muted-foreground">{{ t('book.detail.files.readAloud.dialog.skipped') }}</span>
        <span v-if="row.duration" class="hidden shrink-0 text-[12px] tabular-nums text-muted-foreground sm:inline">{{ row.duration }}</span>
        <span class="flex shrink-0">
          <button
            :ref="(element) => setMoveButton(row.id, 'up', element)"
            type="button"
            class="inline-flex size-8 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:text-muted-foreground aria-disabled:hover:bg-transparent"
            :aria-label="t('book.detail.files.readAloud.dialog.moveUp', { name: row.name })"
            :aria-disabled="row.position === 1 ? 'true' : undefined"
            @click="moveTrack(row.id, -1)"
          >
            <ArrowUp class="size-3.5" aria-hidden="true" />
          </button>
          <button
            :ref="(element) => setMoveButton(row.id, 'down', element)"
            type="button"
            class="inline-flex size-8 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:text-muted-foreground aria-disabled:hover:bg-transparent"
            :aria-label="t('book.detail.files.readAloud.dialog.moveDown', { name: row.name })"
            :aria-disabled="row.position === total ? 'true' : undefined"
            @click="moveTrack(row.id, 1)"
          >
            <ArrowDown class="size-3.5" aria-hidden="true" />
          </button>
        </span>
      </li>
    </ol>
    <p class="sr-only" aria-live="polite">{{ announcement }}</p>
  </div>
</template>
