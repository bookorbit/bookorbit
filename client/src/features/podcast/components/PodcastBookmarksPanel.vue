<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookmarkPlus, Pencil, Save, Trash2, X } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { PodcastBookmark } from '@bookorbit/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { usePodcastPlayer } from '../composables/usePodcastPlayer'
import { usePodcastShortcuts } from '../composables/usePodcastShortcuts'
import { formatPlaybackClock } from '../lib/podcast-format'

const player = usePodcastPlayer()
const { bookmarkComposerRequest } = usePodcastShortcuts()
const { t } = useI18n()
const composerOpen = ref(false)
const editingBookmarkId = ref<number | null>(null)
const editingBookmarkTitle = ref('')
const editingBookmarkNote = ref('')
const titleInput = ref<InstanceType<typeof Input> | null>(null)

watch(bookmarkComposerRequest, () => {
  composerOpen.value = true
  // `$el` is the underlying input: the composer is opened by a shortcut, so focus has to be moved
  // explicitly rather than left to `autofocus`, which only ever fires on first mount.
  void nextTick(() => titleInput.value?.$el?.focus())
})

function openComposer() {
  composerOpen.value = true
}

function closeComposer() {
  composerOpen.value = false
  player.bookmarkTitle.value = ''
  player.bookmarkNote.value = ''
}

async function createBookmark() {
  try {
    await player.createBookmark()
    closeComposer()
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : t('podcast.errors.createBookmark'))
  }
}

function seekBookmark(bookmark: PodcastBookmark) {
  player.seekTo(bookmark.positionSeconds)
}

function startEditingBookmark(bookmark: PodcastBookmark) {
  editingBookmarkId.value = bookmark.id
  editingBookmarkTitle.value = bookmark.title
  editingBookmarkNote.value = bookmark.note ?? ''
}

function cancelEditingBookmark() {
  editingBookmarkId.value = null
  editingBookmarkTitle.value = ''
  editingBookmarkNote.value = ''
}

async function saveBookmark() {
  const bookmark = player.bookmarks.value.find((item) => item.id === editingBookmarkId.value)
  if (!bookmark || !editingBookmarkTitle.value.trim()) return
  try {
    await player.updateBookmark(bookmark, editingBookmarkTitle.value, editingBookmarkNote.value)
    cancelEditingBookmark()
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : t('podcast.errors.updateBookmark'))
  }
}

async function deleteBookmark(bookmark: PodcastBookmark) {
  try {
    await player.deleteBookmark(bookmark)
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : t('podcast.errors.deleteBookmark'))
  }
}
</script>

<template>
  <section class="rounded-2xl border border-border bg-card shadow-[var(--elevation-xs)]">
    <header class="flex items-center justify-between gap-3 px-4 py-3.5">
      <div class="flex items-center gap-2.5">
        <h2 class="font-serif text-base font-semibold">{{ t('podcast.bookmarks.title') }}</h2>
        <Badge v-if="player.bookmarks.value.length" variant="secondary" class="text-[11px] tabular-nums">
          {{ player.bookmarks.value.length }}
        </Badge>
        <span v-else-if="!composerOpen" class="text-xs text-muted-foreground">{{ t('podcast.bookmarks.empty') }}</span>
      </div>
      <Button
        v-if="!composerOpen"
        type="button"
        variant="outline"
        size="sm"
        class="text-muted-foreground hover:text-foreground"
        @click="openComposer"
      >
        <BookmarkPlus class="size-3.5" /> {{ t('podcast.actions.add') }}
      </Button>
      <Button
        v-else
        type="button"
        variant="ghost"
        size="icon-sm"
        class="text-muted-foreground hover:text-foreground"
        :aria-label="t('podcast.bookmarks.closeForm')"
        @click="closeComposer"
      >
        <X :size="15" />
      </Button>
    </header>

    <form v-if="composerOpen" class="border-t border-border p-4" @submit.prevent="createBookmark">
      <p class="mb-3 text-xs font-medium tabular-nums text-muted-foreground">
        {{ t('podcast.bookmarks.saveAt', { time: formatPlaybackClock(player.currentTime.value) }) }}
      </p>
      <Input
        ref="titleInput"
        v-model="player.bookmarkTitle.value"
        maxlength="500"
        :placeholder="t('podcast.bookmarks.titlePlaceholder')"
        :aria-label="t('podcast.bookmarks.titleLabel')"
      />
      <Textarea
        v-model="player.bookmarkNote.value"
        maxlength="10000"
        rows="3"
        class="mt-2 resize-y"
        :placeholder="t('podcast.bookmarks.notePlaceholder')"
        :aria-label="t('podcast.bookmarks.noteLabel')"
      />
      <div class="mt-3 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" class="text-muted-foreground hover:text-foreground" @click="closeComposer">
          {{ t('podcast.actions.cancel') }}
        </Button>
        <Button type="submit" size="sm">{{ t('podcast.bookmarks.save') }}</Button>
      </div>
    </form>

    <div v-if="player.bookmarks.value.length" class="border-t border-border">
      <article v-for="bookmark in player.bookmarks.value" :key="bookmark.id" class="border-b border-border px-4 py-3 last:border-b-0">
        <template v-if="editingBookmarkId === bookmark.id">
          <Input v-model="editingBookmarkTitle" maxlength="500" :aria-label="t('podcast.bookmarks.editTitleLabel')" />
          <Textarea
            v-model="editingBookmarkNote"
            maxlength="10000"
            rows="3"
            class="mt-2 resize-y"
            :aria-label="t('podcast.bookmarks.editNoteLabel')"
          />
          <div class="mt-2 flex justify-end gap-2">
            <Button variant="ghost" size="sm" class="text-muted-foreground hover:text-foreground" @click="cancelEditingBookmark">
              <X class="size-3.5" /> {{ t('podcast.actions.cancel') }}
            </Button>
            <Button size="sm" @click="saveBookmark"> <Save class="size-3.5" /> {{ t('podcast.actions.save') }} </Button>
          </div>
        </template>
        <template v-else>
          <div class="flex items-start gap-3">
            <button
              type="button"
              class="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              @click="seekBookmark(bookmark)"
            >
              <span class="block truncate text-sm font-medium">{{ bookmark.title }}</span>
              <span class="mt-0.5 block text-xs tabular-nums text-muted-foreground">{{ formatPlaybackClock(bookmark.positionSeconds) }}</span>
              <span v-if="bookmark.note" class="mt-1.5 block line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{{
                bookmark.note
              }}</span>
            </button>
            <div class="flex shrink-0 items-center gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                class="text-muted-foreground hover:text-foreground"
                :aria-label="t('podcast.bookmarks.edit')"
                @click="startEditingBookmark(bookmark)"
              >
                <Pencil :size="14" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                class="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                :aria-label="t('podcast.bookmarks.delete')"
                @click="deleteBookmark(bookmark)"
              >
                <Trash2 :size="14" />
              </Button>
            </div>
          </div>
        </template>
      </article>
    </div>
  </section>
</template>
