<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Search, SlidersHorizontal } from '@lucide/vue'
import type { AuditActorOption, AuditCategory } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatNumber } from '@/i18n/formatters'
import { AUDIT_CATEGORY_ORDER, getAuditPerson } from '../audit-display'
import type { AuditPersonFilter } from '../useAuditLog'
import AuditCategoryTile from './AuditCategoryTile.vue'
import AuditPersonLabel from './AuditPersonLabel.vue'

const props = defineProps<{
  category: AuditCategory | null
  person: AuditPersonFilter | null
  categoryCounts: Partial<Record<AuditCategory, number>>
  actors: AuditActorOption[]
  activeCount: number
}>()
const emit = defineEmits<{
  'update:category': [value: AuditCategory | null]
  'update:person': [value: AuditPersonFilter | null]
  clear: []
  opened: []
}>()
const { t } = useI18n()
const open = ref(false)
const personQuery = ref('')

const categories = computed(() => AUDIT_CATEGORY_ORDER.filter((category) => category !== 'other' || (props.categoryCounts.other ?? 0) > 0))

const people = computed(() => {
  const query = personQuery.value.trim().toLowerCase()
  return props.actors
    .map((actor) => ({ actor, person: getAuditPerson({ actorUsername: actor.username, userId: actor.userId, actorName: actor.name }) }))
    .filter(({ actor, person }) => !query || actor.username.toLowerCase().includes(query) || person.name.toLowerCase().includes(query))
    .sort((a, b) => Number(a.person.kind === 'deleted') - Number(b.person.kind === 'deleted') || a.person.name.localeCompare(b.person.name))
})

function onOpenChange(value: boolean) {
  open.value = value
  if (value) emit('opened')
}

function toggleCategory(category: AuditCategory) {
  emit('update:category', props.category === category ? null : category)
}

function togglePerson(actor: AuditActorOption, name: string) {
  emit('update:person', props.person?.username === actor.username ? null : { username: actor.username, name })
}

function clearAll() {
  personQuery.value = ''
  emit('clear')
}

function close() {
  open.value = false
}
</script>

<template>
  <Popover :open="open" @update:open="onOpenChange">
    <PopoverTrigger as-child>
      <Button
        variant="outline"
        type="button"
        class="h-9 gap-1.5 px-2.5 max-md:size-9 max-md:px-0"
        :class="activeCount > 0 ? 'border-primary/45 text-primary hover:text-primary' : ''"
        :aria-label="t('audit.filterMenu.button')"
      >
        <SlidersHorizontal :size="15" aria-hidden="true" />
        <span class="max-md:sr-only">{{ t('audit.filterMenu.button') }}</span>
        <span v-if="activeCount > 0" class="rounded-xs bg-primary/15 px-1 text-xs tabular-nums text-primary max-md:hidden">{{ activeCount }}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" class="w-[23.75rem] max-w-[calc(100vw-2rem)] p-3">
      <p class="px-1 pb-2 text-[10.5px] leading-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
        {{ t('audit.filterMenu.category') }}
      </p>
      <div class="grid grid-cols-2 gap-0.5">
        <button
          v-for="option in categories"
          :key="option"
          type="button"
          class="flex h-9 min-w-0 items-center gap-2 rounded-sm px-2 text-start text-[13px] text-foreground hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:cursor-default disabled:opacity-45 disabled:hover:bg-transparent"
          :class="category === option ? 'bg-primary/10 font-medium text-primary hover:bg-primary/10' : ''"
          :aria-pressed="category === option"
          :disabled="!(categoryCounts[option] ?? 0) && category !== option"
          @click="toggleCategory(option)"
        >
          <AuditCategoryTile :category="option" />
          <span class="truncate">{{ t(`audit.categories.${option}`) }}</span>
          <span class="ms-auto text-xs tabular-nums text-muted-foreground">{{ formatNumber(categoryCounts[option] ?? 0) }}</span>
        </button>
      </div>

      <div class="-mx-3 my-2 h-px bg-border" />

      <p class="px-1 pb-2 text-[10.5px] leading-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
        {{ t('audit.filterMenu.person') }}
      </p>
      <label class="relative block">
        <span class="sr-only">{{ t('audit.filterMenu.findPerson') }}</span>
        <Search :size="14" class="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          id="audit-person-search"
          v-model="personQuery"
          type="search"
          class="input-field h-8 w-full ps-8 text-[13px]"
          :placeholder="t('audit.filterMenu.findPerson')"
        />
      </label>
      <ul class="mt-1.5 max-h-56 overflow-y-auto">
        <li v-for="{ actor, person: option } in people" :key="actor.username">
          <button
            type="button"
            class="flex h-[34px] w-full min-w-0 items-center gap-2 rounded-sm px-2 text-start text-[13px] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            :class="person?.username === actor.username ? 'bg-primary/10 hover:bg-primary/10' : ''"
            :aria-pressed="person?.username === actor.username"
            @click="togglePerson(actor, option.name)"
          >
            <AuditPersonLabel :person="option" class="min-w-0" />
            <span v-if="option.kind === 'user' && option.name !== actor.username" class="truncate font-mono text-xs text-muted-foreground"
              >@{{ actor.username }}</span
            >
            <Check v-if="person?.username === actor.username" :size="15" class="ms-auto shrink-0 text-primary" aria-hidden="true" />
          </button>
        </li>
        <li v-if="people.length === 0" class="px-2 py-3 text-center text-xs text-muted-foreground">{{ t('audit.filterMenu.noPeople') }}</li>
      </ul>

      <div class="-mx-3 mt-2 flex justify-end gap-2 border-t border-border px-3 pt-2.5">
        <Button variant="ghost" size="sm" type="button" @click="clearAll">{{ t('audit.filterMenu.clear') }}</Button>
        <Button size="sm" type="button" @click="close">{{ t('audit.filterMenu.done') }}</Button>
      </div>
    </PopoverContent>
  </Popover>
</template>
