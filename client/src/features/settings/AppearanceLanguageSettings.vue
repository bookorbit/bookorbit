<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Languages } from '@lucide/vue'
import { LOCALE_LABELS, type Locale } from '@bookorbit/types'
import { toast } from 'vue-sonner'
import LanguagePicker from '@/components/LanguagePicker.vue'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useLocaleStore } from '@/stores/locale'

const { t } = useI18n()
const localeStore = useLocaleStore()

const pickerOpen = ref(false)
const currentLabel = computed(() => LOCALE_LABELS[localeStore.locale])

async function selectLanguage(locale: Locale) {
  pickerOpen.value = false

  try {
    await localeStore.setLocale(locale)
  } catch {
    toast.error(t('settings.appearance.language.loadError'))
  }
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <p class="settings-group-label">
        {{ t('settings.appearance.language.title') }}
      </p>
      <div class="settings-card">
        <div class="settings-row">
          <div>
            <p class="settings-label">
              {{ t('settings.appearance.language.label') }}
            </p>
            <p class="settings-hint">
              {{ t('settings.appearance.language.description') }}
            </p>
          </div>
          <Popover v-model:open="pickerOpen">
            <PopoverTrigger as-child>
              <Button variant="outline" class="self-start justify-between gap-2 min-w-48" data-testid="settings-language-trigger">
                <Languages :size="15" class="text-muted-foreground" />
                <span :lang="localeStore.locale">{{ currentLabel }}</span>
                <ChevronDown :size="15" class="ms-auto text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" class="w-80 p-1">
              <LanguagePicker :autofocus="pickerOpen" class="max-h-[min(26rem,calc(100dvh-8rem))]" @select="selectLanguage" />
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  </div>
</template>
