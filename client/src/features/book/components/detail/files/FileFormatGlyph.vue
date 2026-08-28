<script setup lang="ts">
import { computed } from 'vue'
import { formatColorVar } from '@/features/book/lib/format-colors'

const props = withDefaults(defineProps<{ format: string | null; size?: 'sm' | 'md' | 'lg' }>(), { size: 'md' })

const sizeClass = computed(
  () =>
    ({
      sm: 'h-[2.375rem] w-[1.9375rem] pb-[4px] text-[9.5px]',
      md: 'h-[2.125rem] w-7 pb-1 text-[8px]',
      lg: 'h-[4.125rem] w-[3.375rem] pb-[9px] text-[13px]',
    })[props.size],
)

/** The dog-eared corner is drawn, not an image, so it inherits the format colour at any size. */
const cornerClass = computed(() => (props.size === 'lg' ? 'size-[15px]' : props.size === 'sm' ? 'size-2.5' : 'size-2'))

const glyphStyle = computed(() => {
  const color = formatColorVar(props.format)
  const notch = props.size === 'lg' ? '15px' : props.size === 'sm' ? '10px' : '8px'
  return {
    color,
    backgroundColor: `color-mix(in oklch, ${color} 22%, transparent)`,
    clipPath: `polygon(0 0, calc(100% - ${notch}) 0, 100% ${notch}, 100% 100%, 0 100%)`,
    borderRadius: props.size === 'lg' ? '5px 0 5px 5px' : props.size === 'sm' ? '4px 0 4px 4px' : '3px 0 3px 3px',
  }
})
</script>

<template>
  <span
    class="relative flex shrink-0 items-end justify-center font-bold uppercase leading-none tracking-wide"
    :class="sizeClass"
    :style="glyphStyle"
    aria-hidden="true"
  >
    <span class="absolute right-0 top-0 bg-current opacity-25" :class="cornerClass" />
    <span class="relative">{{ format || '?' }}</span>
  </span>
</template>
