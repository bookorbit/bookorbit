<script setup lang="ts">
import type { Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search } from '@lucide/vue'
import AppIcon from '@/components/AppIcon.vue'
import PageMenuButton from '@/components/page-header/PageMenuButton.vue'
import { useCommandPalette } from '@/features/command-palette/composables/useCommandPalette'

/**
 * The one title row every page opens with, sized to line up with the sidebar's logo row. On phones
 * the shell has no header, so the menu button takes the icon tile's place and a search button joins
 * the actions; routes that render this row set `meta.titleRow` so the fallback bar stays away.
 */
withDefaults(
  defineProps<{
    eyebrow?: string
    title?: string
    icon?: Component | string | null
    fallbackIcon?: Component | string
    /** Settings nests under its own pages' headings, so it keeps the title one level down. */
    headingTag?: 'h1' | 'h2'
    headingTestId?: string
    /** Let the inline slot take the row's free width, for filters that end in their own search field. */
    inlineGrow?: boolean
  }>(),
  { eyebrow: '', title: '', icon: null, fallbackIcon: undefined, headingTag: 'h1', headingTestId: undefined, inlineGrow: false },
)

const slots = defineSlots<{
  eyebrow?: () => unknown
  /** Sits on the title's baseline, before the heading: a breadcrumb trail. */
  titleLead?: () => unknown
  title?: () => unknown
  subtitle?: () => unknown
  facts?: () => unknown
  inline?: () => unknown
  actions?: () => unknown
}>()

const { t } = useI18n()
const { openPalette } = useCommandPalette()

function handleSearch() {
  openPalette()
}
</script>

<template>
  <div class="flex min-h-11 items-center gap-3 max-sm:flex-wrap max-sm:gap-y-2 sm:gap-3.5" data-testid="page-title-row">
    <PageMenuButton class="-ms-1 size-9" />
    <span
      class="grid size-9 shrink-0 place-items-center rounded-[9px] border border-primary/30 bg-primary/12 text-primary max-md:hidden sm:size-11 sm:rounded-[10px]"
      aria-hidden="true"
    >
      <component :is="icon" v-if="icon && typeof icon !== 'string'" :size="20" aria-hidden="true" />
      <AppIcon v-else :icon="icon" :fallback="fallbackIcon" :size="20" />
    </span>
    <div class="flex min-w-0 flex-col justify-center" :class="slots.inline ? 'shrink' : 'flex-1'">
      <slot name="eyebrow">
        <span v-if="eyebrow" class="text-[10.5px] leading-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">{{ eyebrow }}</span>
      </slot>
      <div class="flex min-w-0 items-baseline gap-3">
        <div class="flex min-w-0 items-baseline gap-1.5">
          <slot name="titleLead" />
          <component :is="headingTag" class="flex max-w-full min-w-0 shrink-0" :data-testid="headingTestId">
            <slot name="title">
              <span class="block truncate text-[19px] leading-[25px] font-bold tracking-[-0.015em] text-foreground sm:text-[22px] sm:leading-[27px]">
                {{ title }}
              </span>
            </slot>
          </component>
        </div>
        <p v-if="slots.facts" class="flex min-w-0 shrink-[3] items-center gap-2 overflow-hidden text-[13px] whitespace-nowrap text-muted-foreground">
          <slot name="facts" />
        </p>
      </div>
      <p v-if="slots.subtitle" class="mt-0.5 truncate text-[13px] text-muted-foreground">
        <slot name="subtitle" />
      </p>
    </div>
    <template v-if="slots.inline">
      <div class="flex min-w-0 items-center max-sm:order-last max-sm:basis-full sm:ms-2" :class="{ 'flex-1': inlineGrow }">
        <slot name="inline" />
      </div>
      <span v-if="!inlineGrow" class="min-w-0 flex-1" aria-hidden="true" />
    </template>
    <button
      type="button"
      class="grid size-9 shrink-0 place-items-center rounded-md text-foreground transition-colors hover:bg-(--shell-accent-wash) md:hidden"
      :aria-label="t('common.search')"
      @click="handleSearch"
    >
      <Search :size="17" aria-hidden="true" />
    </button>
    <div v-if="slots.actions" class="flex shrink-0 items-center gap-2">
      <slot name="actions" />
    </div>
  </div>
</template>
