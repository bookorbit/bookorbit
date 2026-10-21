<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRef, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, Search, X } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { AuthorDetail } from '@bookorbit/types'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import MetadataCacheNotice from '@/features/metadata-cache/components/MetadataCacheNotice.vue'
import SearchFreshButton from '@/features/metadata-cache/components/SearchFreshButton.vue'
import { showCacheFallbackToast } from '@/features/metadata-cache/lib/cache-feedback'
import { splitMetadataCacheUsage, usageFallbackProviders } from '@/features/metadata-cache/lib/metadata-cache'
import { AuthorMetadataMatchError } from '../api/author'
import { useAuthorMatchPicker, type AuthorMatchEntry } from '../composables/useAuthorMatchPicker'
import { authorProviderLabel } from '../lib/author-metadata-match'
import AuthorMatchDetail from './AuthorMatchDetail.vue'
import AuthorMatchRow from './AuthorMatchRow.vue'

const props = defineProps<{ author: AuthorDetail }>()
const emit = defineEmits<{ close: []; updated: [AuthorDetail] }>()

const { t } = useI18n()
const id = useId()

const {
  query,
  reference,
  rows,
  cacheSummary,
  searching,
  searched,
  searchFailed,
  selected,
  selectedKey,
  currentKey,
  currentLookupComplete,
  current,
  loadingDetailKey,
  lookingUpReference,
  referenceError,
  search,
  searchFresh,
  select,
  clearSelection,
  lookUpReference,
  loadCurrent,
  pin,
  unpin,
  cancel,
} = useAuthorMatchPicker(toRef(props, 'author'))

const confirmOpen = ref(false)
const pinning = ref(false)
const unpinning = ref(false)
const busy = computed(() => pinning.value || unpinning.value)

const selectedIsCurrent = computed(() => !!selected.value && selected.value.key === currentKey.value)
const loadingDetail = computed(() => !!selected.value && loadingDetailKey.value === selected.value.key)
const showFallbackUnpin = computed(
  () =>
    props.author.metadataProviderPinned &&
    currentLookupComplete.value &&
    searched.value &&
    !current.value &&
    !rows.value.some((entry) => entry.key === currentKey.value),
)
const selectedProviderLabel = computed(() => (selected.value ? authorProviderLabel(selected.value.candidate.provider) : ''))
const showCacheNotice = computed(() => searched.value && !searching.value && cacheSummary.value.cachedCount > 0)
const resultStatus = computed(() => {
  if (searching.value) return t('author.match.results.searching')
  if (searchFailed.value) return t('author.match.results.failed')
  if (searched.value && rows.value.length === 0) return t('author.match.results.empty')
  if (searched.value) return t('author.match.results.count', { count: rows.value.length })
  return ''
})
const referenceErrorMessage = computed(() => {
  switch (referenceError.value) {
    case 'unrecognised':
      return t('author.match.reference.unrecognised')
    case 'notFound':
      return t('author.match.reference.notFound')
    case 'failed':
      return t('author.match.reference.failed')
    default:
      return ''
  }
})

function handleOpenChange(open: boolean) {
  if (!open && !busy.value) emit('close')
}

function handleSearch() {
  void search()
}

function handleSearchFresh() {
  void searchFresh()
}

function handleLookUp() {
  void lookUpReference()
}

function handleSelect(entry: AuthorMatchEntry) {
  select(entry)
}

function handleUse() {
  confirmOpen.value = true
}

function handleCancelConfirm() {
  if (!pinning.value) confirmOpen.value = false
}

function matchErrorMessage(error: unknown, provider: string): string {
  if (error instanceof AuthorMetadataMatchError && error.status === 404) return t('author.match.toast.notFound', { provider })
  if (error instanceof AuthorMetadataMatchError && error.status === 503) return t('author.match.toast.providerDown', { provider })
  return t('author.match.toast.failed')
}

async function handleConfirm() {
  const entry = selected.value
  if (!entry || pinning.value) return
  const provider = authorProviderLabel(entry.candidate.provider)
  pinning.value = true
  try {
    const { value: updated, usage } = splitMetadataCacheUsage(await pin(entry))
    confirmOpen.value = false
    emit('updated', updated)
    toast.success(t('author.match.toast.pinned', { name: entry.candidate.name, provider }))
    showCacheFallbackToast(usageFallbackProviders(usage), authorProviderLabel)
    emit('close')
  } catch (error) {
    confirmOpen.value = false
    toast.error(matchErrorMessage(error, provider))
  } finally {
    pinning.value = false
  }
}

async function handleUnpin() {
  if (unpinning.value) return
  unpinning.value = true
  try {
    emit('updated', await unpin())
    toast.success(t('author.match.toast.unpinned'))
  } catch {
    toast.error(t('author.match.toast.unpinFailed'))
  } finally {
    unpinning.value = false
  }
}

onMounted(() => {
  void loadCurrent()
  void search()
})

onBeforeUnmount(cancel)
</script>

<template>
  <Sheet :open="true" @update:open="handleOpenChange">
    <SheetContent
      side="right"
      hide-close
      class="w-full gap-0 overflow-hidden border-border p-0 shadow-2xl sm:w-[min(100vw-3rem,60rem)] sm:max-w-none"
    >
      <header class="flex min-h-[3.625rem] shrink-0 items-center gap-3 border-b border-border py-2 ps-4 pe-3">
        <div class="min-w-0 flex-1">
          <SheetTitle class="text-sm font-semibold">{{ t('author.match.title') }}</SheetTitle>
          <SheetDescription class="text-xs leading-snug [overflow-wrap:anywhere] text-muted-foreground">
            {{ t('author.match.description', { name: author.name }) }}
          </SheetDescription>
        </div>
        <SheetClose
          class="grid size-8 place-items-center rounded-lg text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :aria-label="t('common.close')"
        >
          <X class="size-4" aria-hidden="true" />
        </SheetClose>
      </header>

      <div class="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <section class="min-h-0 flex-col border-border md:flex md:border-e" :class="selectedKey ? 'hidden' : 'flex'">
          <div class="shrink-0 space-y-3 border-b border-border p-3">
            <form class="space-y-1" @submit.prevent="handleSearch">
              <label :for="`${id}-query`" class="text-xs text-muted-foreground">{{ t('author.match.search.label') }}</label>
              <div class="flex gap-2">
                <input
                  :id="`${id}-query`"
                  v-model="query"
                  type="search"
                  autocomplete="off"
                  class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm"
                />
                <button
                  type="submit"
                  :disabled="searching || !query.trim()"
                  class="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60"
                >
                  <Search class="size-3.5" aria-hidden="true" />
                  {{ t('author.match.search.submit') }}
                </button>
              </div>
            </form>
            <form class="space-y-1" @submit.prevent="handleLookUp">
              <label :for="`${id}-reference`" class="text-xs text-muted-foreground">{{ t('author.match.reference.label') }}</label>
              <div class="flex gap-2">
                <input
                  :id="`${id}-reference`"
                  v-model="reference"
                  autocomplete="off"
                  class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-sm"
                  :class="referenceError ? 'border-destructive' : ''"
                  :placeholder="t('author.match.reference.placeholder')"
                  :aria-invalid="!!referenceError || undefined"
                  :aria-describedby="referenceError ? `${id}-reference-error` : undefined"
                />
                <button
                  type="submit"
                  :disabled="lookingUpReference || !reference.trim()"
                  class="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-input px-3 text-sm text-foreground hover:bg-muted disabled:opacity-60"
                >
                  <Loader2 v-if="lookingUpReference" class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  {{ t('author.match.reference.submit') }}
                </button>
              </div>
              <p v-if="referenceError" :id="`${id}-reference-error`" class="text-xs text-destructive" role="alert">{{ referenceErrorMessage }}</p>
            </form>
          </div>

          <div class="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 pt-3">
            <p class="text-xs text-muted-foreground" role="status">{{ resultStatus }}</p>
            <div class="flex items-center gap-2">
              <button
                v-if="showFallbackUnpin"
                type="button"
                :disabled="busy"
                class="h-8 rounded-md border border-input px-3 text-sm text-foreground hover:bg-muted disabled:opacity-60"
                @click="handleUnpin"
              >
                {{ t('author.match.detail.unpin') }}
              </button>
              <SearchFreshButton v-if="searched && !searching && !showCacheNotice" @search-fresh="handleSearchFresh" />
            </div>
          </div>
          <MetadataCacheNotice v-if="showCacheNotice" class="mx-3 mt-2" :summary="cacheSummary" @search-fresh="handleSearchFresh" />

          <ul class="min-h-0 flex-1 space-y-1 overflow-y-auto p-2" :aria-label="t('author.match.results.label')">
            <li v-for="entry in rows" :key="entry.key">
              <AuthorMatchRow :entry="entry" :selected="entry.key === selectedKey" :current="entry.key === currentKey" @select="handleSelect" />
            </li>
          </ul>
        </section>

        <section class="min-h-0 flex-col md:flex" :class="selectedKey ? 'flex' : 'hidden'">
          <AuthorMatchDetail
            :entry="selected"
            :loading="loadingDetail"
            :current="selectedIsCurrent"
            :pinned="author.metadataProviderPinned"
            :busy="busy"
            @use="handleUse"
            @unpin="handleUnpin"
            @back="clearSelection"
          />
        </section>
      </div>
    </SheetContent>
  </Sheet>

  <ConfirmDialog
    :open="confirmOpen"
    :title="t('author.match.confirm.title', { provider: selectedProviderLabel })"
    :description="t('author.match.confirm.description')"
    :confirm-label="t('author.match.confirm.confirm')"
    :busy="pinning"
    :destructive="false"
    @confirm="handleConfirm"
    @cancel="handleCancelConfirm"
  />
</template>
