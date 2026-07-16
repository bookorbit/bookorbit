<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    name?: string | null
    avatarUrl?: string | null
    sizeClass?: string
    textClass?: string
  }>(),
  {
    name: null,
    avatarUrl: null,
    sizeClass: 'h-8 w-8',
    textClass: 'text-xs',
  },
)

const imageFailed = ref(false)

const initials = computed(() => {
  const raw = props.name?.trim()
  if (!raw) return '?'
  const parts = raw.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase()
  return `${parts[0]!.slice(0, 1)}${parts[parts.length - 1]!.slice(0, 1)}`.toUpperCase()
})

const src = computed(() => props.avatarUrl ?? null)

watch(
  src,
  () => {
    imageFailed.value = false
  },
  { immediate: true },
)
</script>

<template>
  <span
    :class="[
      'inline-flex items-center justify-center overflow-hidden rounded-[inherit] bg-primary/15 text-primary font-semibold select-none',
      sizeClass,
    ]"
  >
    <img
      v-if="src && !imageFailed"
      :src="src"
      :alt="props.name ? t('components.userAvatar.profilePictureOf', { name: props.name }) : t('components.userAvatar.profilePicture')"
      class="h-full w-full object-cover"
      @error="imageFailed = true"
    />
    <span v-else :class="textClass">{{ initials }}</span>
  </span>
</template>
