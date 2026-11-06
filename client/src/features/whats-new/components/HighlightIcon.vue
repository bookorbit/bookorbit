<script setup lang="ts">
import { computed } from 'vue'
import { Sparkles } from '@lucide/vue'
import AppIcon from '@/components/AppIcon.vue'
import { isIconNameShape } from '../lib/whats-new.logic'

const props = withDefaults(defineProps<{ name: string | null; size?: number }>(), { size: 18 })

const iconName = computed(() => (isIconNameShape(props.name) ? props.name : null))
</script>

<template>
  <AppIcon :icon="iconName" :fallback="Sparkles" :size="size" />
</template>
