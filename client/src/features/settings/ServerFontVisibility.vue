<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Users } from '@lucide/vue'
import type { useCustomFonts } from '@/features/reader/epub/composables/useCustomFonts'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'

const props = defineProps<{
  customFonts: ReturnType<typeof useCustomFonts>
}>()

const { t } = useI18n()

const families = computed(() => props.customFonts.serverFamilies.value)
const visibleCount = computed(() => props.customFonts.visibleServerFamilies.value.length)

const pending = ref<Set<string>>(new Set())

const previewStyleEl = ref<HTMLStyleElement | null>(null)

// Server fonts are not part of this page's own collection, so their @font-face rules have
// to be injected here for the names below to render in their own typeface.
watch(
  () => props.customFonts.serverFonts.value,
  () => {
    const css = props.customFonts.scopeStore('server').generateFontFaceCSS()
    if (previewStyleEl.value) {
      previewStyleEl.value.textContent = css
      return
    }
    if (!css) return
    const el = document.createElement('style')
    el.setAttribute('data-server-font-visibility-preview', '')
    el.textContent = css
    document.head.appendChild(el)
    previewStyleEl.value = el
  },
  { immediate: true },
)

onUnmounted(() => {
  previewStyleEl.value?.remove()
  previewStyleEl.value = null
})

async function toggleFamily(familyName: string, shown: boolean) {
  pending.value = new Set([...pending.value, familyName])
  try {
    const ok = await props.customFonts.setServerFamilyHidden(familyName, !shown)
    if (!ok) toast.error(t('settings.reader.fonts.serverFontVisibilityFailed'))
  } finally {
    const next = new Set(pending.value)
    next.delete(familyName)
    pending.value = next
  }
}
</script>

<template>
  <div v-if="families.length > 0" class="mt-8">
    <div class="flex items-center justify-between mb-2">
      <p class="settings-group-label mb-0">{{ t('settings.reader.fonts.serverFontsTitle') }}</p>
      <span class="text-xs text-muted-foreground">{{
        t('settings.reader.fonts.serverFontsShown', { count: visibleCount, total: families.length })
      }}</span>
    </div>

    <p class="mb-3 text-xs text-muted-foreground">{{ t('settings.reader.fonts.serverFontsHint') }}</p>

    <div class="settings-card">
      <div v-for="family in families" :key="family.cssFamilyName" class="flex items-center gap-3 bg-card px-4 py-3">
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium" :style="{ fontFamily: `'${family.cssFamilyName}', sans-serif` }">
            {{ family.name }}
          </p>
          <p class="mt-0.5 text-xs text-muted-foreground">
            {{ t('settings.reader.fonts.fileCount', { count: family.variants.length }) }}
          </p>
        </div>

        <ToggleSwitch
          :model-value="!customFonts.isServerFamilyHidden(family.name)"
          :disabled="pending.has(family.name)"
          :aria-label="family.name"
          @update:model-value="(shown: boolean) => toggleFamily(family.name, shown)"
        />
      </div>
    </div>

    <p v-if="visibleCount === 0" class="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
      <Users :size="13" class="shrink-0" />
      {{ t('settings.reader.fonts.serverFontsAllHidden') }}
    </p>
  </div>
</template>
