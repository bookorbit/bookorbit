<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePage } from '@embedpdf/vue/runtime'
import type { Link } from '@embedpdf/vue/link'

const props = defineProps<{ link: Link; url: URL }>()
const emit = defineEmits<{ open: [url: URL] }>()

const { t } = useI18n()
const page = usePage()

const box = computed(() => {
  const { bounds } = props.link
  const topLeft = page.value.transform.toPixels({ x: bounds.x, y: bounds.y })
  const bottomRight = page.value.transform.toPixels({ x: bounds.x + bounds.width, y: bounds.y + bounds.height })
  return {
    left: `${topLeft.x}px`,
    top: `${topLeft.y}px`,
    width: `${bottomRight.x - topLeft.x}px`,
    height: `${bottomRight.y - topLeft.y}px`,
  }
})

function handleClick() {
  emit('open', props.url)
}
</script>

<template>
  <button
    type="button"
    class="pointer-events-auto absolute cursor-pointer rounded-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    :style="box"
    :title="props.url.href"
    :aria-label="t('reader.pdf.openExternalLink', { url: props.url.href })"
    @pointerdown.stop
    @click="handleClick"
  />
</template>
