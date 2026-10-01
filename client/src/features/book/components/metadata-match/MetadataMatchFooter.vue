<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowRight, ChevronUp, ListChecks, Undo2 } from '@lucide/vue'
import type { MetadataProviderInfo, MetadataProviderKey } from '@bookorbit/types'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { StagedChange } from '../../composables/useMetadataDiff'
import { getProviderColor, getProviderLabel, hideOnError, providerBadgeStyle } from '../../lib/metadata-fetch'

const props = defineProps<{
  staged: StagedChange[]
  providers: MetadataProviderInfo[]
  /** What Apply does with the changes, when it is not filling a form that still needs saving. */
  hint?: string
}>()

const emit = defineEmits<{
  apply: []
  cancel: []
  unstage: [key: string]
  clearAll: []
}>()

const { t } = useI18n()

const count = computed(() => props.staged.length)
const sources = computed<MetadataProviderKey[]>(() => [...new Set(props.staged.map((change) => change.candidate.provider))])

function providerLabel(provider: MetadataProviderKey): string {
  return getProviderLabel(provider, props.providers)
}

function labelOf(change: StagedChange): string {
  return t(change.labelKey, change.labelParams ?? {})
}

function handleApply() {
  emit('apply')
}

function handleCancel() {
  emit('cancel')
}

function handleUnstage(key: string) {
  emit('unstage', key)
}

function handleClearAll() {
  emit('clearAll')
}
</script>

<template>
  <footer class="flex items-center gap-3 border-t border-border bg-card/60 px-4 py-2.5 @3xl/match:ps-[1.125rem]">
    <span class="sr-only" aria-live="polite">{{ t('book.detail.editMetadata.match.footer.live', { count }) }}</span>
    <div class="flex min-w-0 flex-1 items-center gap-2.5">
      <Popover v-if="count">
        <PopoverTrigger as-child>
          <button
            type="button"
            class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted"
          >
            <ListChecks class="size-3.5" aria-hidden="true" />
            {{ t('book.detail.editMetadata.match.footer.changes', { count }) }}
            <ChevronUp class="size-3" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" :side-offset="8" class="w-[min(31rem,calc(100vw-2rem))] overflow-hidden p-0">
          <div class="flex items-center justify-between border-b border-border/60 px-3 py-2.5">
            <span class="text-[10.5px] font-bold tracking-[0.12em] text-muted-foreground uppercase">{{
              t('book.detail.editMetadata.match.footer.stagedHeading')
            }}</span>
            <button type="button" class="-mx-1 rounded-md px-1 py-0.5 text-[11.5px] font-medium hover:bg-muted" @click="handleClearAll">
              {{ t('book.detail.editMetadata.match.footer.clearAll') }}
            </button>
          </div>
          <ul class="max-h-80 overflow-y-auto">
            <li
              v-for="change in staged"
              :key="change.key"
              class="grid grid-cols-[7rem_minmax(0,1fr)_1.75rem] items-start gap-2.5 border-b border-border/60 px-3 py-2 text-[12.5px] last:border-b-0"
            >
              <span class="grid justify-items-start gap-0.5">
                <span class="font-semibold">{{ labelOf(change) }}</span>
                <span
                  class="inline-flex h-[18px] items-center rounded-md px-1.5 text-[10.5px] font-bold"
                  :style="providerBadgeStyle(change.candidate.provider)"
                  >{{ providerLabel(change.candidate.provider) }}</span
                >
              </span>
              <span v-if="change.isCover" class="flex items-center gap-2">
                <span class="block h-10 w-7 overflow-hidden rounded-sm bg-muted ring-1 ring-border">
                  <img v-if="change.before" :src="change.before" alt="" class="size-full object-cover" @error="hideOnError" />
                </span>
                <ArrowRight class="size-3 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
                <span class="block h-10 w-7 overflow-hidden rounded-sm bg-muted ring-1 ring-border">
                  <img :src="change.after" alt="" class="size-full object-cover" @error="hideOnError" />
                </span>
              </span>
              <span v-else class="grid min-w-0 gap-0.5">
                <span
                  class="text-muted-foreground [overflow-wrap:anywhere]"
                  :class="[change.before ? 'line-through' : 'italic', change.field === 'description' ? 'line-clamp-3' : '']"
                  :title="change.field === 'description' ? change.before : undefined"
                  >{{ change.before || t('book.detail.editMetadata.match.value.empty') }}</span
                >
                <span class="flex min-w-0 items-start gap-1.5">
                  <ArrowRight class="mt-[3px] size-3 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
                  <span
                    class="min-w-0 [overflow-wrap:anywhere]"
                    :class="change.field === 'description' ? 'line-clamp-3' : ''"
                    :title="change.field === 'description' ? change.after : undefined"
                  >
                    {{ change.after
                    }}<span v-if="change.merged" class="text-muted-foreground"> ({{ t('book.detail.editMetadata.match.footer.merged') }})</span>
                  </span>
                </span>
              </span>
              <button
                type="button"
                class="grid size-7 place-items-center rounded-md text-foreground hover:bg-muted"
                :aria-label="t('book.detail.editMetadata.match.footer.undo', { field: labelOf(change) })"
                @click="handleUnstage(change.key)"
              >
                <Undo2 class="size-3.5" aria-hidden="true" />
              </button>
            </li>
          </ul>
        </PopoverContent>
      </Popover>
      <span v-if="count" class="hidden min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground @2xl/match:flex">
        {{ t('book.detail.editMetadata.match.footer.from') }}
        <span v-for="provider in sources" :key="provider" class="inline-flex items-center gap-1">
          <span class="size-[7px] rounded-full" :style="{ backgroundColor: getProviderColor(provider) }" />{{ providerLabel(provider) }}
        </span>
      </span>
      <span v-else class="min-w-0 text-[12.5px] leading-snug text-muted-foreground">
        <span class="@2xl/match:hidden">{{ t('book.detail.editMetadata.match.footer.nothingStagedShort') }}</span>
        <span class="hidden @2xl/match:inline">{{ t('book.detail.editMetadata.match.footer.nothingStaged') }}</span>
      </span>
    </div>
    <span class="hidden text-[11.5px] whitespace-nowrap text-muted-foreground @4xl/match:inline">{{
      hint ?? t('book.detail.editMetadata.match.footer.formHint')
    }}</span>
    <button
      type="button"
      class="hidden h-8 items-center rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-muted @2xl/match:inline-flex"
      @click="handleCancel"
    >
      {{ t('common.cancel') }}
    </button>
    <button
      type="button"
      class="inline-flex h-8 items-center rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
      :disabled="!count"
      @click="handleApply"
    >
      {{ t('book.detail.editMetadata.match.footer.apply', { count }) }}
    </button>
  </footer>
</template>
