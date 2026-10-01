<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check } from '@lucide/vue'
import { APP_FEATURES, type CoverAspectRatio, type LibraryType } from '@bookorbit/types'
import AppIcon from '@/components/AppIcon.vue'
import IconPicker from '@/components/IconPicker.vue'
import LibraryCreatorCard from './LibraryCreatorCard.vue'

const { t } = useI18n()

/** A short, library-flavoured starting set. Anything else is one click away in the full picker. */
const SUGGESTED_ICONS = [
  'Library',
  'LibraryBig',
  'BookOpen',
  'BookOpenText',
  'BookCopy',
  'BookMarked',
  'FolderBookmark',
  'Bookmark',
  'BookHeadphones',
  'Headphones',
  'AudioLines',
  'ScrollText',
  'Newspaper',
  'GraduationCap',
  'Feather',
  'Sparkles',
  'Swords',
  'Rocket',
  'Ghost',
  'Heart',
  'Star',
  'Moon',
  'Baby',
  'Layers',
]

const props = defineProps<{
  name: string
  icon: string | null
  coverAspectRatio: CoverAspectRatio
  type: LibraryType
  typeLocked: boolean
}>()

const emit = defineEmits<{
  'update:name': [value: string]
  'update:icon': [value: string | null]
  'update:coverAspectRatio': [value: CoverAspectRatio]
  'update:type': [value: LibraryType]
  'update:pickerOpen': [value: boolean]
}>()

const iconChoices = computed(() => (props.icon && !SUGGESTED_ICONS.includes(props.icon) ? [props.icon, ...SUGGESTED_ICONS] : SUGGESTED_ICONS))

const coverOptions = computed<{ value: CoverAspectRatio; title: string; hint: string; tiles: string[] }[]>(() => [
  {
    value: '2/3',
    title: t('library.creator.details.cover.portraitTitle'),
    hint: t('library.creator.details.cover.portraitHint'),
    tiles: ['var(--format-ebook)', 'var(--format-document)', 'var(--format-audio)'],
  },
  {
    value: '1/1',
    title: t('library.creator.details.cover.squareTitle'),
    hint: t('library.creator.details.cover.squareHint'),
    tiles: ['var(--format-kindle)', 'var(--format-comic)', 'var(--format-audio)'],
  },
])

function iconLabel(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
}

function updateName(event: Event) {
  emit('update:name', (event.target as HTMLInputElement).value)
}

function selectIcon(name: string) {
  emit('update:icon', name)
}

function pickIcon(value: string) {
  if (value) emit('update:icon', value)
}

function handlePickerOpen(open: boolean) {
  emit('update:pickerOpen', open)
}

function updateCoverAspectRatio(event: Event) {
  emit('update:coverAspectRatio', (event.target as HTMLInputElement).value as CoverAspectRatio)
}

function selectBooksType() {
  emit('update:type', 'books')
}

function selectPodcastsType() {
  emit('update:type', 'podcasts')
}
</script>

<template>
  <div class="flex flex-col gap-3.5">
    <LibraryCreatorCard v-if="APP_FEATURES.podcasts" :label="t('library.creator.details.type.title')">
      <div class="grid gap-2 @md:grid-cols-2">
        <button
          type="button"
          class="rounded-lg border px-3.5 py-2.5 text-start transition-colors disabled:cursor-not-allowed"
          :class="type === 'books' ? 'border-primary bg-primary/8 ring-1 ring-primary' : 'border-border bg-background hover:bg-muted'"
          :aria-pressed="type === 'books'"
          :disabled="typeLocked"
          @click="selectBooksType"
        >
          <span class="block text-sm font-medium text-foreground">{{ t('library.creator.details.type.books') }}</span>
          <span class="mt-0.5 block text-xs text-muted-foreground">{{ t('library.creator.details.type.booksHint') }}</span>
        </button>
        <button
          type="button"
          class="rounded-lg border px-3.5 py-2.5 text-start transition-colors disabled:cursor-not-allowed"
          :class="type === 'podcasts' ? 'border-primary bg-primary/8 ring-1 ring-primary' : 'border-border bg-background hover:bg-muted'"
          :aria-pressed="type === 'podcasts'"
          :disabled="typeLocked"
          @click="selectPodcastsType"
        >
          <span class="block text-sm font-medium text-foreground">{{ t('library.creator.details.type.podcasts') }}</span>
          <span class="mt-0.5 block text-xs text-muted-foreground">{{ t('library.creator.details.type.podcastsHint') }}</span>
        </button>
      </div>
    </LibraryCreatorCard>

    <LibraryCreatorCard :label="t('library.creator.details.identity')">
      <div class="flex items-end gap-3.5">
        <span
          class="flex size-13 shrink-0 items-center justify-center rounded-2xl"
          :class="icon ? 'bg-primary/12 text-primary' : 'border-[1.5px] border-dashed border-primary/45 text-primary'"
          aria-hidden="true"
        >
          <AppIcon :icon="icon || 'Library'" fallback="Library" :size="24" />
        </span>
        <div class="min-w-0 flex-1">
          <label for="library-name" class="mb-1.5 block text-xs font-medium text-muted-foreground">
            {{ type === 'podcasts' ? t('library.creator.details.podcastName') : t('library.creator.details.libraryName') }}
          </label>
          <input
            id="library-name"
            type="text"
            :value="name"
            :placeholder="type === 'podcasts' ? t('library.creator.details.podcastPlaceholder') : t('library.creator.details.namePlaceholder')"
            maxlength="255"
            class="h-10 w-full rounded-lg border border-input bg-background px-3 text-[15px] font-medium text-foreground placeholder:font-normal placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            autocomplete="off"
            @input="updateName"
          />
        </div>
      </div>

      <div class="mt-4">
        <div class="mb-2 flex items-center gap-2">
          <p id="library-icon-label" class="text-xs font-medium text-muted-foreground">{{ t('library.creator.details.icon.label') }}</p>
          <div class="ms-auto">
            <IconPicker
              model-value=""
              hide-text
              :placeholder="t('library.creator.details.icon.more')"
              @update:model-value="pickIcon"
              @open-change="handlePickerOpen"
            />
          </div>
        </div>
        <div role="group" aria-labelledby="library-icon-label" class="grid grid-cols-[repeat(auto-fill,2.5rem)] justify-between gap-1.5">
          <button
            v-for="choice in iconChoices"
            :key="choice"
            type="button"
            class="flex size-10 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :class="
              icon === choice
                ? 'border-primary bg-primary/14 text-primary ring-1 ring-primary'
                : 'border-border bg-background text-foreground hover:bg-muted'
            "
            :aria-pressed="icon === choice"
            :aria-label="iconLabel(choice)"
            :title="iconLabel(choice)"
            @click="selectIcon(choice)"
          >
            <AppIcon :icon="choice" fallback="Library" :size="17" />
          </button>
        </div>
      </div>
    </LibraryCreatorCard>

    <LibraryCreatorCard v-if="type === 'books'" :label="t('library.creator.details.coverStyle.title')">
      <fieldset aria-describedby="cover-style-description">
        <legend class="sr-only">{{ t('library.creator.details.coverStyle.title') }}</legend>
        <div class="grid gap-2.5 @md:grid-cols-2">
          <label
            v-for="option in coverOptions"
            :key="option.value"
            class="flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors focus-within:ring-2 focus-within:ring-ring"
            :class="
              coverAspectRatio === option.value ? 'border-primary bg-primary/8 ring-1 ring-primary' : 'border-border bg-background hover:bg-muted'
            "
          >
            <input
              type="radio"
              name="cover-aspect-ratio"
              :value="option.value"
              :checked="coverAspectRatio === option.value"
              class="sr-only"
              @change="updateCoverAspectRatio"
            />
            <span class="flex h-8 shrink-0 items-end gap-1" aria-hidden="true">
              <span
                v-for="tile in option.tiles"
                :key="tile"
                class="rounded-[3px] shadow-xs"
                :class="option.value === '2/3' ? 'h-8 w-5' : 'size-7'"
                :style="{ backgroundColor: tile }"
              />
            </span>
            <span class="min-w-0">
              <span class="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                {{ option.title }}
                <Check v-if="coverAspectRatio === option.value" :size="14" class="text-primary" aria-hidden="true" />
              </span>
              <span class="block text-xs text-muted-foreground">{{ option.hint }}</span>
            </span>
          </label>
        </div>
        <p id="cover-style-description" class="mt-2.5 text-xs text-muted-foreground">{{ t('library.creator.details.cover.slotsHint') }}</p>
      </fieldset>
    </LibraryCreatorCard>
  </div>
</template>
