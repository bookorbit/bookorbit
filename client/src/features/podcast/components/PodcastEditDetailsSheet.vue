<script setup lang="ts">
import { computed, provide, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Link, Trash2, Upload } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { PODCAST_MAX_CATEGORIES, type PodcastArtworkResult, type PodcastMetadataUpdateResult, type PodcastSummary } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import Chip from '@/components/ui/Chip.vue'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import FormSheet from '@/components/FormSheet.vue'
import { useFilePicker } from '@/composables/useFilePicker'
import PodcastArtwork from './PodcastArtwork.vue'
import PodcastFieldLabel from './PodcastFieldLabel.vue'
import { PODCAST_LOCKS_ENABLED } from '../lib/podcast-locks'
import { usePodcastArtworkEditor } from '../composables/usePodcastArtworkEditor'
import { usePodcastMetadataEditor } from '../composables/usePodcastMetadataEditor'

const props = defineProps<{ open: boolean; show: PodcastSummary }>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  saved: [result: PodcastMetadataUpdateResult]
  'artwork-changed': [result: PodcastArtworkResult]
}>()

const { t } = useI18n()
const editor = usePodcastMetadataEditor()
const podcastId = computed(() => props.show.id)
const artwork = usePodcastArtworkEditor(podcastId)
const categoryDraft = ref('')
const artworkUrl = ref('')
const { input: fileInput, open: openFilePicker, handleChange: handleFileChange } = useFilePicker(artwork.selectFile)

const form = editor.form
const artworkSrc = computed(() => artwork.previewSrc.value ?? props.show.imageUrl)
/** A replacement can keep the same URL, so the failure state is cleared by version rather than by src. */
const artworkVersion = computed(() => `${props.show.id}:${props.show.artworkUpdatedAt ?? ''}`)
const hasCustomArtwork = computed(() => props.show.artworkUpdatedAt !== null)
const hasPendingArtwork = computed(() => Boolean(artwork.pendingFile.value || artwork.pendingUrl.value))
const categoryLimitReached = computed(() => form.categories.length >= PODCAST_MAX_CATEGORIES)
const busy = computed(() => editor.saving.value || artwork.busy.value)
const isLocalShow = computed(() => props.show.origin === 'local')
const description = computed(() => (isLocalShow.value ? t('podcast.edit.localDescription') : t('podcast.edit.description')))

// A lock guards a field against the next feed refresh, and a local show never refreshes, so an edit
// to one is already permanent and the toggles have nothing left to do.
provide(
  PODCAST_LOCKS_ENABLED,
  computed(() => !isLocalShow.value),
)

function handleOpened() {
  editor.load(props.show)
  categoryDraft.value = ''
  artworkUrl.value = ''
  artwork.clearPending()
}

function handleOpenChange(open: boolean) {
  emit('update:open', open)
}

function close() {
  emit('update:open', false)
}

function handleCategoryKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== ',') return
  event.preventDefault()
  commitCategory()
}

function commitCategory() {
  if (editor.addCategory(categoryDraft.value)) categoryDraft.value = ''
}

function removeCategory(category: string) {
  editor.removeCategory(category)
}

/** Reads the value off the update rather than the ref: `Input` emits after the next flush. */
function handleArtworkUrlInput(value: string | number) {
  artwork.setUrl(String(value))
}

function cancelPendingArtwork() {
  artwork.clearPending()
  artworkUrl.value = ''
}

async function confirmArtwork() {
  const result = await artwork.confirm()
  if (!result) {
    toast.error(artwork.error.value ?? t('podcast.errors.updateArtwork'))
    return
  }
  artworkUrl.value = ''
  emit('artwork-changed', result)
  toast.success(t('podcast.messages.artworkUpdated'))
}

async function removeArtwork() {
  const result = await artwork.revert()
  if (!result) {
    toast.error(artwork.error.value ?? t('podcast.errors.removeArtwork'))
    return
  }
  artworkUrl.value = ''
  emit('artwork-changed', result)
  toast.success(t('podcast.messages.artworkRemoved'))
}

async function handleSave() {
  if (!form.title.trim()) {
    toast.error(t('podcast.errors.titleRequired'))
    return
  }
  if (!editor.hasChanges.value) {
    close()
    return
  }
  const result = await editor.save(props.show.id)
  if (!result) {
    toast.error(editor.error.value ?? t('podcast.errors.updatePodcast'))
    return
  }
  emit('saved', result)
  toast.success(t('podcast.messages.detailsSaved'))
  close()
}
</script>

<template>
  <FormSheet
    :open="open"
    :title="t('podcast.edit.title')"
    :description="description"
    content-class="sm:max-w-lg"
    :reset-key="show.id"
    :busy="busy"
    :dirty="editor.isDirty.value"
    submit-test-id="podcast-save-details"
    data-testid="podcast-edit-details-sheet"
    @update:open="handleOpenChange"
    @opened="handleOpened"
    @submit="handleSave"
  >
    <div class="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4">
      <section aria-labelledby="podcast-edit-artwork-heading">
        <h3 id="podcast-edit-artwork-heading" class="text-xs font-medium">{{ t('podcast.edit.artworkTitle') }}</h3>
        <div class="mt-2 flex gap-3">
          <PodcastArtwork :src="artworkSrc" :reset-key="artworkVersion" class="size-24 shrink-0 rounded-xl" />
          <div class="min-w-0 flex-1 space-y-2">
            <p class="text-xs leading-5 text-muted-foreground">{{ t('podcast.edit.artworkHint') }}</p>
            <div class="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" :disabled="busy" @click="openFilePicker">
                <Upload class="size-3.5" /> {{ t('podcast.edit.chooseImage') }}
              </Button>
              <Button
                v-if="hasCustomArtwork"
                type="button"
                variant="outline"
                size="sm"
                class="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                :disabled="busy"
                data-testid="podcast-remove-custom-artwork"
                @click="removeArtwork"
              >
                <Trash2 class="size-3.5" /> {{ t('podcast.edit.removeCustomArtwork') }}
              </Button>
            </div>
            <input
              ref="fileInput"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              class="hidden"
              @change="handleFileChange"
            />
            <label class="block text-xs font-medium" for="podcast-edit-artwork-url">
              {{ t('podcast.edit.artworkUrlLabel') }}
              <span class="relative mt-1.5 block">
                <Link class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="podcast-edit-artwork-url"
                  v-model="artworkUrl"
                  type="url"
                  inputmode="url"
                  maxlength="8192"
                  :placeholder="t('podcast.edit.artworkUrlPlaceholder')"
                  class="pl-8"
                  @update:model-value="handleArtworkUrlInput"
                />
              </span>
            </label>
            <div v-if="hasPendingArtwork" class="flex flex-wrap gap-2">
              <Button type="button" size="sm" :disabled="busy" data-testid="podcast-confirm-artwork" @click="confirmArtwork">
                {{ t('podcast.edit.useImage') }}
              </Button>
              <Button type="button" variant="outline" size="sm" :disabled="busy" @click="cancelPendingArtwork">
                {{ t('podcast.actions.cancel') }}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <PodcastFieldLabel
        :label="t('podcast.edit.titleLabel')"
        field="title"
        input-id="podcast-edit-title"
        :locked="editor.isLocked('title')"
        :will-lock="editor.willLock('title')"
        :disabled="busy"
        @toggle="editor.toggleLock"
      >
        <Input id="podcast-edit-title" v-model="form.title" type="text" maxlength="1000" required />
      </PodcastFieldLabel>

      <PodcastFieldLabel
        :label="t('podcast.edit.authorLabel')"
        field="author"
        input-id="podcast-edit-author"
        :locked="editor.isLocked('author')"
        :will-lock="editor.willLock('author')"
        :disabled="busy"
        @toggle="editor.toggleLock"
      >
        <Input id="podcast-edit-author" v-model="form.author" type="text" maxlength="1000" :placeholder="t('podcast.edit.authorPlaceholder')" />
      </PodcastFieldLabel>

      <PodcastFieldLabel
        :label="t('podcast.edit.descriptionLabel')"
        field="description"
        input-id="podcast-edit-description"
        :locked="editor.isLocked('description')"
        :will-lock="editor.willLock('description')"
        :disabled="busy"
        @toggle="editor.toggleLock"
      >
        <Textarea
          id="podcast-edit-description"
          v-model="form.description"
          rows="6"
          maxlength="100000"
          :placeholder="t('podcast.edit.descriptionPlaceholder')"
        />
        <p class="text-xs text-muted-foreground">{{ t('podcast.edit.descriptionHint') }}</p>
      </PodcastFieldLabel>

      <PodcastFieldLabel
        :label="t('podcast.edit.siteUrlLabel')"
        field="siteUrl"
        input-id="podcast-edit-site-url"
        :locked="editor.isLocked('siteUrl')"
        :will-lock="editor.willLock('siteUrl')"
        :disabled="busy"
        @toggle="editor.toggleLock"
      >
        <Input
          id="podcast-edit-site-url"
          v-model="form.siteUrl"
          type="url"
          inputmode="url"
          maxlength="8192"
          :placeholder="t('podcast.edit.siteUrlPlaceholder')"
        />
      </PodcastFieldLabel>

      <PodcastFieldLabel
        :label="t('podcast.edit.languageLabel')"
        field="language"
        input-id="podcast-edit-language"
        :locked="editor.isLocked('language')"
        :will-lock="editor.willLock('language')"
        :disabled="busy"
        @toggle="editor.toggleLock"
      >
        <Input id="podcast-edit-language" v-model="form.language" type="text" maxlength="100" :placeholder="t('podcast.edit.languagePlaceholder')" />
      </PodcastFieldLabel>

      <PodcastFieldLabel
        :label="t('podcast.edit.categoriesLabel')"
        field="categories"
        input-id="podcast-edit-categories"
        :locked="editor.isLocked('categories')"
        :will-lock="editor.willLock('categories')"
        :disabled="busy"
        @toggle="editor.toggleLock"
      >
        <ul v-if="form.categories.length" class="flex flex-wrap gap-1.5" :aria-label="t('podcast.edit.categoriesLabel')">
          <li v-for="category in form.categories" :key="category">
            <Chip
              variant="primary"
              removable
              :remove-label="t('podcast.edit.removeCategory', { category })"
              :disabled="busy"
              @remove="removeCategory(category)"
            >
              {{ category }}
            </Chip>
          </li>
        </ul>
        <div class="flex gap-2">
          <Input
            id="podcast-edit-categories"
            v-model="categoryDraft"
            type="text"
            maxlength="200"
            class="flex-1"
            :disabled="categoryLimitReached"
            :placeholder="t('podcast.edit.categoriesPlaceholder')"
            @keydown="handleCategoryKeydown"
          />
          <Button type="button" variant="outline" :disabled="categoryLimitReached || !categoryDraft.trim()" @click="commitCategory">
            {{ t('podcast.actions.add') }}
          </Button>
        </div>
        <p v-if="categoryLimitReached" class="text-xs text-warning">{{ t('podcast.edit.categoryLimit', { count: PODCAST_MAX_CATEGORIES }) }}</p>
      </PodcastFieldLabel>

      <PodcastFieldLabel
        :label="t('podcast.edit.explicitLabel')"
        field="explicit"
        input-id="podcast-edit-explicit"
        :locked="editor.isLocked('explicit')"
        :will-lock="editor.willLock('explicit')"
        :disabled="busy"
        @toggle="editor.toggleLock"
      >
        <div class="flex items-center gap-2">
          <ToggleSwitch id="podcast-edit-explicit" v-model="form.explicit" :disabled="busy" />
          <span class="text-xs text-muted-foreground">{{ t('podcast.edit.explicitHint') }}</span>
        </div>
      </PodcastFieldLabel>
    </div>
  </FormSheet>
</template>
