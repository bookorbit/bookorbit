<script setup lang="ts">
import { ref, type HTMLAttributes } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Languages } from '@lucide/vue'
import type { Locale } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import LanguagePicker from '@/components/LanguagePicker.vue'
import { useLocaleStore } from '@/stores/locale'

defineProps<{ controlClass: HTMLAttributes['class']; isMobile: boolean; isRail: boolean; anchor?: HTMLElement | null }>()

const { t } = useI18n()
const localeStore = useLocaleStore()

const popoverOpen = ref(false)
const sheetOpen = ref(false)

function openSheet() {
  sheetOpen.value = true
}

async function selectLanguage(locale: Locale) {
  popoverOpen.value = false
  sheetOpen.value = false
  try {
    await localeStore.setLocale(locale)
  } catch {
    toast.error(t('settings.appearance.language.loadError'))
  }
}
</script>

<template>
  <Tooltip v-if="isMobile">
    <TooltipTrigger as-child>
      <Button variant="ghost" size="icon" :class="controlClass" :aria-label="t('settings.appearance.language.label')" @click="openSheet">
        <Languages :size="15" aria-hidden="true" />
      </Button>
    </TooltipTrigger>
    <TooltipContent side="top">{{ t('settings.appearance.language.label') }}</TooltipContent>
  </Tooltip>

  <Tooltip v-else>
    <Popover v-model:open="popoverOpen">
      <TooltipTrigger as-child>
        <PopoverTrigger as-child>
          <Button
            data-testid="language-control"
            variant="ghost"
            size="icon"
            :class="controlClass"
            :aria-label="t('settings.appearance.language.label')"
          >
            <Languages :size="15" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
      </TooltipTrigger>
      <PopoverContent side="right" align="end" :side-offset="12" :reference="anchor ?? undefined" class="w-80 p-1">
        <LanguagePicker :autofocus="popoverOpen" class="max-h-[min(26rem,calc(100dvh-8rem))]" @select="selectLanguage" />
      </PopoverContent>
    </Popover>
    <TooltipContent :side="isRail ? 'right' : 'top'">{{ t('settings.appearance.language.label') }}</TooltipContent>
  </Tooltip>

  <Sheet v-if="isMobile" v-model:open="sheetOpen">
    <SheetContent side="bottom" class="h-[85dvh] rounded-t-xl px-2 pb-2">
      <SheetHeader class="pb-1">
        <SheetTitle>{{ t('settings.appearance.language.label') }}</SheetTitle>
        <SheetDescription class="sr-only">{{ t('settings.appearance.language.description') }}</SheetDescription>
      </SheetHeader>
      <LanguagePicker :autofocus="false" class="min-h-0 flex-1" @select="selectLanguage" />
    </SheetContent>
  </Sheet>
</template>
