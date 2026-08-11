<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Search } from '@lucide/vue'
import { LOCALE_LABELS, SUPPORTED_LOCALES, type Locale } from '@bookorbit/types'
import { Input } from '@/components/ui/input'
import { matchSupportedLocale, useLocaleStore } from '@/stores/locale'

const props = withDefaults(defineProps<{ autofocus?: boolean }>(), { autofocus: false })

const emit = defineEmits<{ select: [locale: Locale] }>()

const { t } = useI18n()
const localeStore = useLocaleStore()

const query = ref('')
const searchInput = ref<InstanceType<typeof Input> | null>(null)

// `zh` names the Simplified catalog, but Intl resolves the bare tag to plain "Chinese",
// which reads as the parent of both scripts next to "Traditional Chinese".
const ENGLISH_NAME_TAGS: Partial<Record<Locale, string>> = { zh: 'zh-Hans' }

const englishNames = computed(() => {
  const display = new Intl.DisplayNames(['en'], { type: 'language' })
  const names = {} as Record<Locale, string>
  for (const locale of SUPPORTED_LOCALES) {
    names[locale] = display.of(ENGLISH_NAME_TAGS[locale] ?? locale) ?? LOCALE_LABELS[locale]
  }
  return names
})

interface LanguageOption {
  id: Locale
  label: string
  englishName: string
}

const allLanguages = computed<LanguageOption[]>(() => {
  const collator = new Intl.Collator('en')
  return SUPPORTED_LOCALES.map((id) => ({ id, label: LOCALE_LABELS[id], englishName: englishNames.value[id] })).sort((a, b) =>
    collator.compare(a.label, b.label),
  )
})

// The browser's own preference order is the best guess we have, and it is the same
// signal the store uses to pick a default before anyone has chosen one.
const suggested = computed<LanguageOption[]>(() => {
  const ids: Locale[] = [localeStore.locale]

  if (typeof navigator !== 'undefined') {
    const candidates = Array.isArray(navigator.languages) && navigator.languages.length > 0 ? navigator.languages : [navigator.language]
    for (const candidate of candidates) {
      if (typeof candidate !== 'string') continue
      const matched = matchSupportedLocale([candidate])
      if (matched && !ids.includes(matched)) ids.push(matched)
    }
  }

  return ids.map((id) => allLanguages.value.find((language) => language.id === id)).filter((language) => language !== undefined)
})

function matches(language: LanguageOption, needle: string): boolean {
  return (
    language.label.toLocaleLowerCase().includes(needle) ||
    language.englishName.toLocaleLowerCase().includes(needle) ||
    language.id.toLocaleLowerCase().startsWith(needle)
  )
}

const trimmedQuery = computed(() => query.value.trim().toLocaleLowerCase())
const isSearching = computed(() => trimmedQuery.value.length > 0)

const results = computed(() => allLanguages.value.filter((language) => matches(language, trimmedQuery.value)))

const groups = computed<{ key: string; heading: string; languages: LanguageOption[] }[]>(() => {
  if (isSearching.value) {
    return results.value.length > 0 ? [{ key: 'results', heading: t('components.languagePicker.results'), languages: results.value }] : []
  }

  return [
    { key: 'suggested', heading: t('components.languagePicker.suggested'), languages: suggested.value },
    { key: 'all', heading: t('components.languagePicker.all'), languages: allLanguages.value },
  ]
})

watch(
  () => props.autofocus,
  async (autofocus) => {
    if (!autofocus) return
    await nextTick()
    searchInput.value?.$el?.focus()
  },
  { immediate: true },
)

function handleSelect(locale: Locale) {
  emit('select', locale)
}
</script>

<template>
  <div class="flex flex-col min-h-0">
    <div class="relative px-1 pb-2 shrink-0">
      <Search :size="15" class="absolute start-4 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" aria-hidden="true" />
      <Input
        ref="searchInput"
        v-model="query"
        type="search"
        class="ps-9"
        :placeholder="t('components.languagePicker.searchPlaceholder')"
        :aria-label="t('components.languagePicker.searchPlaceholder')"
      />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <p v-if="groups.length === 0" class="px-3 py-6 text-center text-sm text-muted-foreground">
        {{ t('components.languagePicker.empty', { query: query.trim() }) }}
      </p>

      <div v-for="group in groups" :key="group.key" class="pb-1">
        <p class="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {{ group.heading }}
        </p>
        <ul class="px-1">
          <li v-for="language in group.languages" :key="`${group.key}-${language.id}`">
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-start text-sm text-foreground hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-current="localeStore.locale === language.id ? 'true' : undefined"
              @click="handleSelect(language.id)"
            >
              <Check v-if="localeStore.locale === language.id" :size="14" class="shrink-0 text-primary" aria-hidden="true" />
              <span v-else class="w-3.5 shrink-0" aria-hidden="true" />
              <span :lang="language.id">{{ language.label }}</span>
              <span class="ms-auto ps-3 text-xs text-muted-foreground">{{ language.englishName }}</span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
