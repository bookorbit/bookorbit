<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatNumber } from '@/i18n/formatters'
import { X, Zap } from '@lucide/vue'
import { api } from '@/lib/api'
import type { GroupRule, SmartScope, Rule, SortSpec } from '@bookorbit/types'
import { useSmartScopes } from '@/features/smart-scope/composables/useSmartScopes'
import BookFilterBuilder from '@/features/book/components/BookFilterBuilder.vue'
import BookSortBuilder from '@/features/book/components/BookSortBuilder.vue'
import IconPicker from '@/components/IconPicker.vue'

const { t } = useI18n()

const TEMPLATES: { id: string; build: () => GroupRule }[] = [
  {
    id: 'hasSeries',
    build: () => ({ type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'series', operator: 'isNotEmpty' } as Rule] }),
  },
  {
    id: 'addedRecently',
    build: () => ({ type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'addedAt', operator: 'withinLast', value: 30 } as Rule] }),
  },
  {
    id: 'pdfOnly',
    build: () => ({ type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'format', operator: 'includesAny', value: ['pdf'] } as Rule] }),
  },
  {
    id: 'noGenres',
    build: () => ({ type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'genre', operator: 'isEmpty' } as Rule] }),
  },
  {
    id: 'epubOnly',
    build: () => ({ type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'format', operator: 'includesAny', value: ['epub'] } as Rule] }),
  },
]

const templates = computed(() => TEMPLATES.map((tpl) => ({ ...tpl, label: t(`smartScope.editorPanel.templates.${tpl.id}`) })))

const props = defineProps<{
  open: boolean
  smartScope: SmartScope | null | undefined
}>()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const { updateSmartScope } = useSmartScopes()

const draftName = ref('')
const draftIcon = ref('')
const draftFilter = ref<GroupRule | undefined>(undefined)
const draftSort = ref<SortSpec[]>([])
const draftSyncToKobo = ref(false)
const saving = ref(false)
const saveError = ref<string | null>(null)
const trimmedDraftName = computed(() => draftName.value.trim())
const trimmedDraftIcon = computed(() => draftIcon.value.trim())

const previewCount = ref<number | null>(null)
const previewLoading = ref(false)
let previewTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && props.smartScope) {
      draftName.value = props.smartScope.name
      draftIcon.value = props.smartScope.icon ?? ''
      draftFilter.value = props.smartScope.filter ?? undefined
      draftSort.value = props.smartScope.defaultSort ? [...props.smartScope.defaultSort] : []
      draftSyncToKobo.value = props.smartScope.syncToKobo
      schedulePreview()
    }
  },
)

function schedulePreview() {
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(fetchPreview, 450)
}

watch([draftFilter, draftSort], schedulePreview, { deep: true })

async function fetchPreview() {
  previewLoading.value = true
  try {
    const body: Record<string, unknown> = {
      sort: draftSort.value,
      pagination: { page: 0, size: 1 },
    }
    if (draftFilter.value) body.filter = draftFilter.value
    const res = await api('/api/v1/books/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    previewCount.value = res.ok ? (await res.json()).total : null
  } catch {
    previewCount.value = null
  } finally {
    previewLoading.value = false
  }
}

function applyTemplate(tpl: (typeof TEMPLATES)[number]) {
  draftFilter.value = tpl.build()
}

function initFilter() {
  draftFilter.value = { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains' }] }
}

function hasCompleteRules(group: GroupRule | undefined): boolean {
  return !!group?.rules.some((rule) => rule.type === 'rule' || hasCompleteRules(rule as GroupRule))
}

async function save() {
  if (!props.smartScope) return
  if (!trimmedDraftName.value) {
    saveError.value = t('smartScope.dialog.nameRequired')
    return
  }
  if (!trimmedDraftIcon.value) {
    saveError.value = t('smartScope.dialog.iconRequired')
    return
  }
  saving.value = true
  saveError.value = null
  try {
    await updateSmartScope(props.smartScope.id, {
      name: trimmedDraftName.value,
      icon: trimmedDraftIcon.value,
      filter: hasCompleteRules(draftFilter.value) ? draftFilter.value : undefined,
      defaultSort: draftSort.value,
      syncToKobo: draftSyncToKobo.value,
    })
    emit('saved')
    emit('close')
  } catch {
    saveError.value = t('smartScope.editorPanel.saveFailed')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="smartScope-fade">
      <div v-if="open" class="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" @click="emit('close')" />
    </Transition>

    <Transition name="smartScope-slide">
      <div v-if="open" class="fixed inset-y-0 right-0 z-50 flex flex-col w-full sm:w-[750px] bg-card border-l border-border shadow-2xl">
        <!-- Header -->
        <div class="flex items-start gap-4 px-6 py-5 border-b border-border shrink-0">
          <div class="flex-1 min-w-0">
            <h2 class="text-base font-semibold text-foreground leading-tight truncate">
              {{ draftName || t('smartScope.editorPanel.untitled') }}
            </h2>
            <p class="text-xs text-muted-foreground mt-0.5">{{ t('smartScope.editorPanel.subtitle') }}</p>
          </div>
          <div class="flex items-center gap-2 shrink-0 mt-0.5">
            <span
              v-if="previewCount !== null || previewLoading"
              class="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium transition-all"
              :class="previewLoading ? 'border-border text-muted-foreground' : 'border-primary/30 bg-primary/8 text-primary'"
            >
              <span v-if="previewLoading" class="animate-pulse">{{ t('smartScope.editorPanel.counting') }}</span>
              <template v-else>{{ t('smartScope.editorPanel.bookCount', { count: formatNumber(previewCount ?? 0) }, previewCount ?? 0) }}</template>
            </span>
            <button
              @click="emit('close')"
              class="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X :size="16" />
            </button>
          </div>
        </div>

        <!-- Scrollable body -->
        <div class="flex-1 overflow-y-auto px-6 py-6 flex flex-col gap-5">
          <!-- Identity card -->
          <div class="rounded-lg border border-border bg-background p-5 flex flex-col gap-4">
            <h3 class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{{ t('smartScope.editorPanel.identity') }}</h3>
            <div class="flex gap-3">
              <div class="flex-1 flex flex-col gap-1.5">
                <label class="text-xs font-medium text-foreground/70">{{ t('smartScope.dialog.name') }}</label>
                <input
                  v-model="draftName"
                  type="text"
                  :placeholder="t('smartScope.dialog.namePlaceholder')"
                  class="h-10 rounded-lg border border-input bg-card text-foreground text-sm px-3 focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground/60"
                />
              </div>
              <div class="flex-1 flex flex-col gap-1.5">
                <label class="text-xs font-medium text-foreground/70">{{ t('smartScope.dialog.icon') }}</label>
                <IconPicker v-model="draftIcon" :placeholder="t('smartScope.dialog.iconPlaceholder')" />
              </div>
            </div>

            <div class="flex items-center justify-between py-1">
              <div>
                <p class="text-sm font-medium text-foreground">{{ t('smartScope.syncToKobo') }}</p>
                <p class="text-xs text-muted-foreground mt-0.5">{{ t('smartScope.syncToKoboHint') }}</p>
              </div>
              <button
                type="button"
                role="switch"
                :aria-checked="draftSyncToKobo"
                class="w-11 h-6 rounded-full transition-colors relative shrink-0"
                :class="draftSyncToKobo ? 'bg-primary' : 'bg-muted'"
                @click="draftSyncToKobo = !draftSyncToKobo"
              >
                <div
                  class="absolute top-1 w-4 h-4 rounded-full bg-white transition-transform shadow-sm"
                  :class="draftSyncToKobo ? 'translate-x-6' : 'translate-x-1'"
                />
              </button>
            </div>
          </div>

          <!-- Filters card -->
          <div class="rounded-lg border border-border bg-background p-5 flex flex-col gap-4">
            <h3 class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{{ t('smartScope.editorPanel.filters') }}</h3>

            <!-- Empty state -->
            <template v-if="!draftFilter">
              <p class="text-sm text-muted-foreground leading-relaxed">{{ t('smartScope.editorPanel.noFilters') }}</p>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="tpl in templates"
                  :key="tpl.id"
                  @click="applyTemplate(tpl)"
                  class="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-dashed border-border bg-muted/30 text-foreground hover:border-primary hover:bg-primary/5 hover:text-primary transition-colors"
                >
                  <Zap :size="11" class="shrink-0" />
                  {{ tpl.label }}
                </button>
              </div>
              <button
                @click="initFilter"
                class="self-start flex items-center gap-1.5 h-9 px-4 rounded-lg border border-input bg-card text-sm text-foreground hover:bg-muted transition-colors"
              >
                {{ t('smartScope.editorPanel.buildFromScratch') }}
              </button>
            </template>

            <!-- Filter builder -->
            <template v-else>
              <BookFilterBuilder v-model="draftFilter" preserve-incomplete-root />
              <div class="flex flex-wrap items-center gap-1.5 pt-3 border-t border-border/50">
                <span class="text-xs text-muted-foreground shrink-0">{{ t('smartScope.editorPanel.replaceWithTemplate') }}</span>
                <button
                  v-for="tpl in templates"
                  :key="tpl.id"
                  @click="applyTemplate(tpl)"
                  class="text-xs px-2.5 py-1 rounded-full border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                >
                  {{ tpl.label }}
                </button>
              </div>
            </template>
          </div>

          <!-- Sort card -->
          <div class="rounded-lg border border-border bg-background p-5 flex flex-col gap-4">
            <h3 class="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{{ t('smartScope.editorPanel.defaultSort') }}</h3>
            <BookSortBuilder v-model="draftSort" />
          </div>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-between px-6 py-4 border-t border-border shrink-0 gap-3">
          <p v-if="saveError" class="text-xs text-destructive">{{ saveError }}</p>
          <div v-else class="flex-1" />
          <div class="flex items-center gap-2 shrink-0">
            <button
              @click="emit('close')"
              class="h-10 px-5 rounded-lg border border-input bg-card text-sm text-foreground hover:bg-muted transition-colors"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              @click="save"
              :disabled="!trimmedDraftName || !trimmedDraftIcon || saving"
              class="h-10 px-6 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {{ saving ? t('smartScope.dialog.saving') : t('smartScope.editorPanel.saveChanges') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.smartScope-fade-enter-active,
.smartScope-fade-leave-active {
  transition: opacity 0.2s ease;
}
.smartScope-fade-enter-from,
.smartScope-fade-leave-to {
  opacity: 0;
}

.smartScope-slide-enter-active,
.smartScope-slide-leave-active {
  transition: transform 0.25s ease;
}
.smartScope-slide-enter-from,
.smartScope-slide-leave-to {
  transform: translateX(100%);
}
</style>
