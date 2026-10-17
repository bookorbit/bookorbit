<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMediaQuery } from '@vueuse/core'
import { Braces, ChevronDown, Network, UserRound, X } from '@lucide/vue'
import type { AuditLogEntry } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { formatBytes } from '@/lib/formatting'
import { formatNumber, formatRelativeTimeFromNow } from '@/i18n/formatters'
import { AUDIT_CATEGORY_STYLE, getAuditCategory, getAuditFacts, getAuditPerson, getAuditSourceKind, type AuditFactKey } from '../audit-display'
import { getBookDeletionAuditMeta } from '../audit-meta'
import type { AuditEventSet } from '../audit-sets'
import { useAuditFormat } from '../useAuditFormat'
import AuditCategoryTile from './AuditCategoryTile.vue'
import AuditPersonLabel from './AuditPersonLabel.vue'
import AuditSourceLabel from './AuditSourceLabel.vue'

const props = defineProps<{
  set: AuditEventSet | null
  loadAround: (entry: AuditLogEntry) => Promise<AuditLogEntry[]>
  loadHistory: (entry: AuditLogEntry) => Promise<{ events: AuditLogEntry[]; total: number }>
}>()
const emit = defineEmits<{
  close: []
  select: [entry: AuditLogEntry]
  onlyPerson: [entry: AuditLogEntry]
  onlyTarget: [entry: AuditLogEntry, label: string]
  onlyIp: [ip: string]
}>()
const { t } = useI18n()
const format = useAuditFormat()
const isNarrow = useMediaQuery('(max-width: 767px)')

const around = ref<AuditLogEntry[]>([])
const history = ref<{ events: AuditLogEntry[]; total: number }>({ events: [], total: 0 })
const contextLoading = ref(false)
let request = 0

const entry = computed(() => props.set?.first ?? null)
const category = computed(() => (entry.value ? getAuditCategory(entry.value.action) : 'other'))
const person = computed(() => (entry.value ? getAuditPerson(entry.value) : null))
const target = computed(() => (entry.value ? format.targetOf(entry.value) : null))
const sourceKind = computed(() => (entry.value ? getAuditSourceKind(entry.value.ip, entry.value.actorUsername) : 'unknown'))
const facts = computed(() => (entry.value ? getAuditFacts(entry.value) : []))
const deletedBooks = computed(() => {
  const meta = entry.value ? getBookDeletionAuditMeta(entry.value) : null
  return meta && meta.books.length > 1 ? meta : null
})
const targetTypeLabel = computed(() => (entry.value?.resource ? format.resourceLabel(entry.value.resource) : ''))
const side = computed(() => (isNarrow.value ? ('bottom' as const) : ('right' as const)))
const sizeClass = computed(() => (isNarrow.value ? 'h-[calc(100%-2rem)] rounded-t-2xl' : 'w-full sm:max-w-[34rem]'))

watch(
  () => entry.value?.id,
  async () => {
    const current = entry.value
    const mine = ++request
    around.value = []
    history.value = { events: [], total: 0 }
    if (!current) return
    contextLoading.value = true
    const [nearby, past] = await Promise.all([
      props.loadAround(current).catch(() => []),
      props.loadHistory(current).catch(() => ({ events: [], total: 0 })),
    ])
    if (mine !== request) return
    around.value = nearby
    history.value = past
    contextLoading.value = false
  },
  { immediate: true },
)

function factValue(key: AuditFactKey, value: string | number) {
  if (key === 'size') return formatBytes(Number(value))
  if (key === 'download' || key === 'dockFile') return `#${value}`
  if (key === 'sharingLevel') return ['private', 'summary', 'detailed'].includes(String(value)) ? t(`audit.facts.sharing.${value}`) : value
  return typeof value === 'number' ? formatNumber(value) : value
}

function targetMeta() {
  if (!target.value || !entry.value) return ''
  if (entry.value.action === 'auth.login.failed') return ''
  if (target.value.gone === 'here') return t('audit.drawer.deletedHere', { type: targetTypeLabel.value })
  if (target.value.gone === 'since') return t('audit.drawer.deletedSince', { type: targetTypeLabel.value })
  return targetTypeLabel.value
}

function onOpenChange(value: boolean) {
  if (!value) emit('close')
}

function close() {
  emit('close')
}

function selectEntry(item: AuditLogEntry) {
  emit('select', item)
}

function onlyPerson() {
  if (entry.value) emit('onlyPerson', entry.value)
}

function onlyTarget() {
  if (entry.value && target.value) emit('onlyTarget', entry.value, target.value.name)
}

function onlyIp() {
  if (entry.value?.ip) emit('onlyIp', entry.value.ip)
}

function personName(item: AuditLogEntry) {
  const who = getAuditPerson(item)
  return who.kind === 'system' ? t('audit.person.system') : who.name
}
</script>

<template>
  <Sheet :open="set !== null" @update:open="onOpenChange">
    <SheetContent :side="side" hide-close class="gap-0 p-0" :class="sizeClass">
      <template v-if="entry && person">
        <SheetTitle class="sr-only">{{ format.actionLabel(entry.action) }}</SheetTitle>
        <SheetDescription class="sr-only">{{ t('audit.drawer.description') }}</SheetDescription>

        <header class="flex shrink-0 items-center gap-3 border-b border-border py-3.5 ps-5 pe-4">
          <AuditCategoryTile :category="category" size="lg" />
          <div class="min-w-0 flex-1">
            <h2 class="truncate text-base font-semibold text-foreground">{{ format.actionLabel(entry.action) }}</h2>
            <p class="mt-0.5 truncate text-xs text-muted-foreground">
              {{
                t('audit.drawer.subtitle', {
                  category: t(`audit.categories.${category}`),
                  day: format.dayTitle(set!.day),
                  time: format.time(entry.createdAt),
                })
              }}
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" type="button" :aria-label="t('audit.drawer.close')" @click="close">
            <X :size="16" aria-hidden="true" />
          </Button>
        </header>

        <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4 sm:p-5">
          <section class="rounded-lg border border-border bg-card px-4 py-1 shadow-xs">
            <dl class="grid grid-cols-[7.5rem_minmax(0,1fr)] text-[13px] leading-[18px] max-sm:grid-cols-[6.5rem_minmax(0,1fr)]">
              <dt class="py-[9px] text-muted-foreground">{{ t('audit.drawer.when') }}</dt>
              <dd class="flex flex-wrap items-baseline gap-x-2 py-[9px]">
                <span class="text-foreground">{{ format.fullDate(entry.createdAt) }}</span>
                <span class="text-xs text-muted-foreground">{{ formatRelativeTimeFromNow(entry.createdAt) }}</span>
              </dd>

              <dt class="border-t border-foreground/8 py-[9px] text-muted-foreground">{{ t('audit.drawer.person') }}</dt>
              <dd class="flex flex-wrap items-center gap-x-2 border-t border-foreground/8 py-[9px]">
                <AuditPersonLabel :person="person" :show-meta="false" />
                <span v-if="person.kind === 'user'" class="font-mono text-xs text-muted-foreground">@{{ person.username }}</span>
                <span v-else-if="person.kind === 'system'" class="text-xs text-muted-foreground">{{ t('audit.person.automation') }}</span>
                <span v-else class="text-xs text-muted-foreground">{{ t('audit.person.deleted') }}</span>
              </dd>

              <dt class="border-t border-foreground/8 py-[9px] text-muted-foreground">{{ t('audit.drawer.source') }}</dt>
              <dd class="border-t border-foreground/8 py-[9px]"><AuditSourceLabel :kind="sourceKind" :ip="entry.ip" /></dd>

              <template v-if="target">
                <dt class="border-t border-foreground/8 py-[9px] text-muted-foreground">
                  {{ entry.action === 'auth.login.failed' ? t('audit.drawer.usernameTried') : t('audit.drawer.target') }}
                </dt>
                <dd class="flex flex-wrap items-baseline gap-x-2 border-t border-foreground/8 py-[9px]">
                  <span class="break-words" :class="target.unnamed ? 'text-muted-foreground' : 'text-foreground'">{{ target.name }}</span>
                  <span v-if="targetMeta()" class="text-xs text-muted-foreground">{{ targetMeta() }}</span>
                </dd>
              </template>

              <template v-for="fact in facts" :key="fact.key">
                <dt class="border-t border-foreground/8 py-[9px] text-muted-foreground">{{ t(`audit.facts.${fact.key}`) }}</dt>
                <dd class="border-t border-foreground/8 py-[9px] text-foreground tabular-nums">{{ factValue(fact.key, fact.value) }}</dd>
              </template>
            </dl>
            <ul v-if="deletedBooks" class="mb-1 border-t border-foreground/8 text-[13px]">
              <li
                v-for="book in deletedBooks.books"
                :key="book.id"
                class="flex justify-between gap-3 border-t border-foreground/8 py-1.5 first:border-t-0"
              >
                <span class="min-w-0 truncate text-foreground">{{ book.title ?? t('audit.untitledBook') }}</span>
                <span class="shrink-0 font-mono text-xs text-muted-foreground">#{{ book.id }}</span>
              </li>
              <li v-if="deletedBooks.omitted > 0" class="border-t border-foreground/8 py-1.5 text-xs text-muted-foreground">
                {{ t('audit.deletedBooksOmitted', { count: deletedBooks.omitted }) }}
              </li>
            </ul>
          </section>

          <section v-if="set!.items.length > 1">
            <div class="mb-2 flex items-baseline justify-between gap-3">
              <h3 class="text-[10.5px] leading-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
                {{ t('audit.drawer.inThisRow', { count: set!.items.length }) }}
              </h3>
            </div>
            <ol class="divide-y divide-foreground/8 rounded-lg border border-border bg-card text-[13px]">
              <li v-for="item in set!.items" :key="item.id" class="grid grid-cols-[6rem_minmax(0,1fr)_auto] gap-3 px-3.5 py-[7px]">
                <span class="text-muted-foreground tabular-nums">{{ format.timeWithSeconds(item.createdAt) }}</span>
                <span class="truncate text-foreground">{{ format.actionLabel(item.action) }}</span>
                <span class="font-mono text-xs text-muted-foreground">#{{ item.id }}</span>
              </li>
            </ol>
          </section>

          <section>
            <div class="mb-2 flex items-baseline justify-between gap-3">
              <h3 class="text-[10.5px] leading-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">{{ t('audit.drawer.around') }}</h3>
              <span class="truncate text-xs text-muted-foreground">{{ t('audit.drawer.aroundHint', { name: personName(entry) }) }}</span>
            </div>
            <p v-if="contextLoading" class="rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
              {{ t('common.loading') }}
            </p>
            <p v-else-if="around.length <= 1" class="rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
              {{ t('audit.drawer.aroundEmpty', { name: personName(entry) }) }}
            </p>
            <ol v-else class="overflow-hidden rounded-lg border border-border bg-card text-[13px]">
              <li v-for="item in around" :key="item.id" class="border-t border-foreground/8 first:border-t-0">
                <button
                  type="button"
                  class="grid h-[34px] w-full grid-cols-[4.25rem_0.5rem_auto_minmax(0,1fr)] items-center gap-x-2.5 px-3 text-start hover:bg-foreground/4 focus-visible:bg-foreground/4 focus-visible:outline-none"
                  :class="item.id === entry.id ? 'bg-primary/9 shadow-[inset_2px_0_0_var(--primary)] hover:bg-primary/9' : ''"
                  :aria-current="item.id === entry.id ? 'true' : undefined"
                  @click="selectEntry(item)"
                >
                  <span class="text-xs text-muted-foreground tabular-nums">{{ format.time(item.createdAt) }}</span>
                  <span
                    class="size-2 rounded-full bg-[var(--c)]"
                    :style="{ '--c': AUDIT_CATEGORY_STYLE[getAuditCategory(item.action)].color }"
                    aria-hidden="true"
                  />
                  <span class="truncate font-medium text-foreground">{{ format.actionLabel(item.action) }}</span>
                  <span class="truncate text-muted-foreground">{{ format.targetOf(item)?.name ?? '' }}</span>
                </button>
              </li>
            </ol>
          </section>

          <section v-if="history.events.length > 1">
            <div class="mb-2 flex items-baseline justify-between gap-3">
              <h3 class="text-[10.5px] leading-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
                {{ t('audit.drawer.history') }}
              </h3>
              <span class="text-xs text-muted-foreground">{{ t('audit.drawer.historyCount', { count: history.total }) }}</span>
            </div>
            <ol class="relative before:absolute before:start-1 before:top-2.5 before:bottom-2.5 before:w-px before:bg-border">
              <li v-for="item in history.events" :key="item.id" class="relative grid grid-cols-[0.5625rem_minmax(0,1fr)] gap-x-3 py-[5px]">
                <span
                  class="relative z-10 mt-[5px] size-[9px] rounded-full shadow-[inset_0_0_0_2px_var(--c)]"
                  :class="item.id === entry.id ? 'bg-[var(--c)]' : 'bg-card'"
                  :style="{ '--c': AUDIT_CATEGORY_STYLE[getAuditCategory(item.action)].color }"
                  aria-hidden="true"
                />
                <button type="button" class="min-w-0 text-start focus-visible:outline-none focus-visible:underline" @click="selectEntry(item)">
                  <span class="block text-[13px] leading-[19px] font-medium text-foreground">
                    {{ format.actionLabel(item.action) }}
                    <span
                      v-if="item.id === entry.id"
                      class="ms-1.5 inline-block rounded-full bg-primary/12 px-1.5 align-[1px] text-[11px] leading-4 font-semibold text-primary"
                      >{{ t('audit.drawer.thisEvent') }}</span
                    >
                  </span>
                  <span class="block text-xs text-muted-foreground">{{
                    t('audit.drawer.historyMeta', {
                      name: personName(item),
                      date: format.dateShort(item.createdAt),
                      time: format.time(item.createdAt),
                    })
                  }}</span>
                </button>
              </li>
            </ol>
          </section>

          <details class="group rounded-md border border-border bg-muted/45">
            <summary
              class="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[13px] font-medium text-foreground [&::-webkit-details-marker]:hidden"
            >
              <Braces :size="14" class="text-muted-foreground" aria-hidden="true" />
              {{ t('audit.drawer.raw') }}
              <ChevronDown :size="14" class="ms-auto text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <dl class="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-3 pt-1 pb-2.5 text-[12.5px] leading-[18px]">
              <dt class="text-muted-foreground">{{ t('audit.drawer.rawEventId') }}</dt>
              <dd class="font-mono text-foreground">{{ entry.id }}</dd>
              <dt class="text-muted-foreground">{{ t('audit.drawer.rawAction') }}</dt>
              <dd class="font-mono break-all text-foreground">{{ entry.action }}</dd>
              <template v-if="entry.resource">
                <dt class="text-muted-foreground">{{ t('audit.drawer.rawTarget') }}</dt>
                <dd class="font-mono break-all text-foreground">
                  {{ entry.resource }}{{ entry.resourceId !== null ? ` #${entry.resourceId}` : '' }}
                </dd>
              </template>
              <dt class="text-muted-foreground">{{ t('audit.drawer.rawNote') }}</dt>
              <dd class="break-words text-foreground">{{ entry.description }}</dd>
            </dl>
            <pre
              v-if="entry.meta"
              class="mx-3 mb-3 overflow-x-auto rounded-md border border-border bg-background px-3 py-2.5 font-mono text-xs leading-[18px] whitespace-pre-wrap text-foreground"
              >{{ JSON.stringify(entry.meta, null, 2) }}</pre>
          </details>
        </div>

        <footer class="flex shrink-0 flex-wrap items-center gap-2 border-t border-border py-3 ps-5 pe-4 max-sm:ps-4">
          <Button variant="outline" size="sm" type="button" class="max-w-full" @click="onlyPerson">
            <UserRound :size="14" aria-hidden="true" />
            <span class="truncate">{{ t('audit.drawer.only', { name: person.kind === 'system' ? t('audit.person.system') : person.name }) }}</span>
          </Button>
          <Button
            v-if="target && entry.resourceId !== null && !target.typeOnly"
            variant="outline"
            size="sm"
            type="button"
            class="max-w-[16rem]"
            @click="onlyTarget"
          >
            <component :is="AUDIT_CATEGORY_STYLE[category].icon" :size="14" aria-hidden="true" />
            <span class="truncate">{{ t('audit.drawer.only', { name: target.name }) }}</span>
          </Button>
          <Button v-if="entry.ip" variant="outline" size="sm" type="button" @click="onlyIp">
            <Network :size="14" aria-hidden="true" />
            <span class="font-mono text-xs">{{ t('audit.drawer.only', { name: entry.ip }) }}</span>
          </Button>
        </footer>
      </template>
    </SheetContent>
  </Sheet>
</template>
