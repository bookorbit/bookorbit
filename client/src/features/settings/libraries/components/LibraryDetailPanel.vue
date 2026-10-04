<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Clock, Copy, FolderOpen, History, Pencil, Tags, Users } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { Library, LibraryAccessEntry, LibraryScanHistoryEntry } from '@bookorbit/types'
import { formatKeyName } from '@/features/book/lib/book-formats'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, formatList, formatNumber } from '@/i18n/formatters'
import UserAvatar from '@/components/UserAvatar.vue'
import { METADATA_LABELS, type LibraryCreatorSectionId } from '@/features/library/composables/useLibraryCreator'
import { copyToClipboard } from '@/lib/clipboard'
import LibraryScanHistory from './LibraryScanHistory.vue'

const props = defineProps<{
  library: Library
  history: LibraryScanHistoryEntry[] | null
  access: LibraryAccessEntry[] | null
  loading: boolean
  failed: boolean
}>()

const emit = defineEmits<{ edit: [library: Library, section: LibraryCreatorSectionId] }>()

const PEOPLE_SHOWN = 3

const { t } = useI18n()

const organizationLabel = computed(() => {
  if (props.library.organizationMode !== 'book_per_file') return t('library.creator.scanner.scanMode.folderAsBook.title')
  return props.library.deriveSeriesFromFolder
    ? t('library.creator.scanner.scanMode.fileAsBookSeries')
    : t('library.creator.scanner.scanMode.fileAsBook.title')
})
const excludeLabel = computed(() =>
  props.library.excludePatterns.length === 0
    ? t('settings.admin.libraries.detail.none')
    : t('settings.admin.libraries.detail.patternCount', { count: props.library.excludePatterns.length }),
)
const precedenceLabel = computed(() =>
  props.library.metadataPrecedence.length === 0
    ? t('settings.admin.libraries.detail.none')
    : formatList(props.library.metadataPrecedence.map((key) => METADATA_LABELS[key] ?? key)),
)
const formatsLabel = computed(() =>
  props.library.allowedFormats.length === 0
    ? t('settings.admin.libraries.detail.allSupported')
    : formatList(props.library.allowedFormats.map((format) => formatKeyName(format))),
)
/** The first few names answer "who can see this" without opening the editor; the rest are counted. */
const shownPeople = computed(() => (props.access ?? []).slice(0, PEOPLE_SHOWN))
const hiddenPeople = computed(() => Math.max(0, (props.access?.length ?? 0) - PEOPLE_SHOWN))
const copiedPath = ref<number | null>(null)
const readingThresholdLabel = computed(() => formatNumber(props.library.readingThreshold / 100, { style: 'percent', maximumFractionDigits: 2 }))
const finishedThresholdLabel = computed(() =>
  formatNumber(props.library.markAsFinishedPercentComplete / 100, { style: 'percent', maximumFractionDigits: 2 }),
)

function editFolders() {
  emit('edit', props.library, 'folders')
}

function editMetadata() {
  emit('edit', props.library, 'metadata')
}

function manageAccess() {
  emit('edit', props.library, 'access')
}

async function copyPath(folderId: number, path: string) {
  if (!(await copyToClipboard(path))) {
    toast.error(t('settings.admin.libraries.pathCopyFailed'))
    return
  }
  copiedPath.value = folderId
  toast.success(t('settings.admin.libraries.pathCopied'))
  setTimeout(() => {
    if (copiedPath.value === folderId) copiedPath.value = null
  }, 1600)
}
</script>

<template>
  <section
    class="border-t border-border bg-background/45 px-5 py-4"
    role="region"
    :aria-label="t('settings.admin.libraries.detailRegion', { name: library.name })"
  >
    <div class="grid gap-x-8 gap-y-6 lg:grid-cols-3">
      <section>
        <h4 class="mb-2.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <FolderOpen :size="12" aria-hidden="true" />
          {{ t('settings.admin.libraries.detail.foldersTitle') }}
          <Button
            variant="ghost"
            size="sm"
            type="button"
            class="ms-auto h-6 px-2 text-xs font-medium normal-case tracking-normal"
            @click="editFolders"
          >
            <Pencil :size="12" aria-hidden="true" />
            {{ t('common.edit') }}
          </Button>
        </h4>
        <dl>
          <div
            v-for="(folder, index) in library.folders"
            :key="folder.id"
            class="flex items-start gap-3 border-t border-border py-1.5 first:border-t-0"
          >
            <dt class="shrink-0 pt-px text-[12.5px] text-muted-foreground">{{ t('settings.admin.libraries.detail.path', { index: index + 1 }) }}</dt>
            <dd class="ms-auto flex min-w-0 items-start gap-1">
              <span data-testid="library-full-path" class="min-w-0 break-all text-end font-mono text-[11px] leading-5 text-foreground" dir="ltr">{{
                folder.path
              }}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                type="button"
                class="size-5 shrink-0"
                :aria-label="copiedPath === folder.id ? t('settings.admin.libraries.pathCopied') : t('settings.admin.libraries.copyPath')"
                @click="copyPath(folder.id, folder.path)"
              >
                <component :is="copiedPath === folder.id ? Check : Copy" :size="12" aria-hidden="true" />
              </Button>
            </dd>
          </div>
          <div class="flex items-center gap-3 border-t border-border py-1.5">
            <dt class="shrink-0 text-[12.5px] text-muted-foreground">{{ t('settings.admin.libraries.detail.organization') }}</dt>
            <dd class="ms-auto text-[12.5px] font-medium text-foreground">{{ organizationLabel }}</dd>
          </div>
          <div class="flex items-center gap-3 border-t border-border py-1.5">
            <dt class="shrink-0 text-[12.5px] text-muted-foreground">{{ t('settings.admin.libraries.detail.excludePatterns') }}</dt>
            <dd class="ms-auto text-[12.5px] font-medium text-foreground">{{ excludeLabel }}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h4 class="mb-2.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Tags :size="12" aria-hidden="true" />
          {{ t('settings.admin.libraries.detail.metadataTitle') }}
          <Button
            variant="ghost"
            size="sm"
            type="button"
            class="ms-auto h-6 px-2 text-xs font-medium normal-case tracking-normal"
            @click="editMetadata"
          >
            <Pencil :size="12" aria-hidden="true" />
            {{ t('common.edit') }}
          </Button>
        </h4>
        <dl>
          <div class="flex items-center gap-3 py-1.5">
            <dt class="shrink-0 text-[12.5px] text-muted-foreground">{{ t('settings.admin.libraries.detail.precedence') }}</dt>
            <dd class="ms-auto min-w-0 truncate text-[12.5px] font-medium text-foreground" :title="precedenceLabel">{{ precedenceLabel }}</dd>
          </div>
          <div class="flex items-center gap-3 border-t border-border py-1.5">
            <dt class="shrink-0 text-[12.5px] text-muted-foreground">{{ t('settings.admin.libraries.detail.allowedFormats') }}</dt>
            <dd class="ms-auto min-w-0 truncate text-[12.5px] font-medium text-foreground" :title="formatsLabel">{{ formatsLabel }}</dd>
          </div>
          <div class="flex items-center gap-3 border-t border-border py-1.5">
            <dt class="shrink-0 text-[12.5px] text-muted-foreground">{{ t('settings.admin.libraries.detail.countsAsStarted') }}</dt>
            <dd class="ms-auto text-[12.5px] font-medium tabular-nums text-foreground">{{ readingThresholdLabel }}</dd>
          </div>
          <div class="flex items-center gap-3 border-t border-border py-1.5">
            <dt class="shrink-0 text-[12.5px] text-muted-foreground">{{ t('settings.admin.libraries.detail.countsAsFinished') }}</dt>
            <dd class="ms-auto text-[12.5px] font-medium tabular-nums text-foreground">
              {{ finishedThresholdLabel }}
            </dd>
          </div>
        </dl>
      </section>

      <section>
        <h4 class="mb-2.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Users :size="12" aria-hidden="true" />
          {{ t('settings.admin.libraries.detail.accessTitle') }}
          <Button
            variant="ghost"
            size="sm"
            type="button"
            class="ms-auto h-6 px-2 text-xs font-medium normal-case tracking-normal"
            @click="manageAccess"
          >
            <Users :size="12" aria-hidden="true" />
            {{ t('settings.admin.libraries.detail.manageAccess') }}
          </Button>
        </h4>
        <dl>
          <div class="flex items-start gap-3 py-1.5">
            <dt class="shrink-0 text-[12.5px] text-muted-foreground">{{ t('settings.admin.libraries.detail.peopleWithAccess') }}</dt>
            <dd class="ms-auto min-w-0 text-[12.5px] font-medium text-foreground">
              <Skeleton v-if="loading" class="h-4 w-16" />
              <span v-else-if="access === null">-</span>
              <span v-else-if="access.length === 0">{{ t('settings.admin.libraries.detail.peopleCount', { count: 0 }) }}</span>
              <ul v-else data-testid="library-access-people" class="flex flex-wrap justify-end gap-x-2.5 gap-y-1">
                <li v-for="person in shownPeople" :key="person.userId" class="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <UserAvatar :name="person.name" size-class="size-4 shrink-0" text-class="text-[8px]" />
                  {{ person.name }}
                </li>
                <li v-if="hiddenPeople > 0" class="text-muted-foreground">
                  {{ t('settings.admin.libraries.detail.peopleMore', { count: hiddenPeople }) }}
                </li>
              </ul>
            </dd>
          </div>
          <div class="flex items-center gap-3 border-t border-border py-1.5">
            <dt class="shrink-0 text-[12.5px] text-muted-foreground">{{ t('settings.admin.libraries.detail.added') }}</dt>
            <dd class="ms-auto text-[12.5px] font-medium text-foreground">
              {{ formatDate(new Date(library.createdAt), { year: 'numeric', month: 'short', day: 'numeric' }) }}
            </dd>
          </div>
          <div class="flex items-center gap-3 border-t border-border py-1.5">
            <dt class="shrink-0 text-[12.5px] text-muted-foreground">{{ t('settings.admin.libraries.detail.coverShape') }}</dt>
            <dd class="ms-auto text-[12.5px] font-medium text-foreground">
              {{ t(`settings.admin.libraries.detail.coverShapeValue.${library.coverAspectRatio === '1/1' ? 'square' : 'portrait'}`) }}
            </dd>
          </div>
        </dl>
      </section>
    </div>

    <section class="mt-5">
      <h4 class="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <History :size="12" aria-hidden="true" />
        {{ t('settings.admin.libraries.detail.historyTitle') }}
      </h4>
      <div v-if="loading" class="space-y-1.5" aria-hidden="true">
        <Skeleton v-for="index in 3" :key="index" class="h-6 w-full" />
      </div>
      <p v-else-if="failed" role="alert" class="text-[12.5px] text-destructive">{{ t('settings.admin.libraries.detail.historyFailed') }}</p>
      <p v-else-if="!history || history.length === 0" class="flex items-center gap-2 py-1 text-[12.5px] text-muted-foreground">
        <Clock :size="13" aria-hidden="true" />
        {{ t('settings.admin.libraries.detail.historyEmpty') }}
      </p>
      <LibraryScanHistory v-else :entries="history" />
    </section>
  </section>
</template>
