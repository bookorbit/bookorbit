<script setup lang="ts">
import { Check, AlertCircle, Loader2 } from 'lucide-vue-next'

export interface StepDefinition {
  label: string
  status: 'pending' | 'done' | 'active' | 'running' | 'failed' | 'saved'
}

defineProps<{
  steps: StepDefinition[]
  activeIndex: number
}>()

const emit = defineEmits<{
  stepClick: [index: number]
}>()

function handleStepClick(index: number) {
  emit('stepClick', index)
}
</script>

<template>
  <nav class="flex flex-col">
    <template v-for="(step, i) in steps" :key="i">
      <button
        class="flex items-start gap-3 rounded-lg px-2.5 py-2.5 text-left w-full transition-colors animate-fade-up"
        :class="i === activeIndex ? 'bg-primary/10' : 'hover:bg-muted'"
        :style="{ animationDelay: `${i * 50}ms` }"
        @click="handleStepClick(i)"
      >
        <span
          class="mt-0.5 size-6 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold transition-all duration-200"
          :class="
            step.status === 'done'
              ? 'bg-emerald-500 text-white'
              : step.status === 'failed'
                ? 'bg-red-500 text-white'
                : step.status === 'running'
                  ? 'bg-sky-500 text-white'
                  : i === activeIndex
                    ? 'bg-primary text-primary-foreground'
                    : 'border-2 border-muted-foreground/25 text-muted-foreground'
          "
        >
          <Check v-if="step.status === 'done'" class="size-3" />
          <AlertCircle v-else-if="step.status === 'failed'" class="size-3" />
          <Loader2 v-else-if="step.status === 'running'" class="size-3 animate-spin" />
          <span v-else>{{ i + 1 }}</span>
        </span>
        <span class="flex flex-col min-w-0 pt-0.5">
          <span class="text-xs font-medium leading-snug" :class="i === activeIndex ? 'text-primary' : 'text-foreground/80'">
            {{ step.label }}
          </span>
          <span v-if="step.status === 'done' && i !== activeIndex" class="text-[10px] text-emerald-600 mt-0.5 leading-none">Done</span>
          <span v-else-if="step.status === 'saved' && i !== activeIndex" class="text-[10px] text-amber-600 mt-0.5 leading-none">Saved</span>
          <span v-else-if="step.status === 'running'" class="text-[10px] text-sky-600 mt-0.5 leading-none">Running</span>
          <span v-else-if="step.status === 'failed'" class="text-[10px] text-red-600 mt-0.5 leading-none">Failed</span>
        </span>
      </button>
      <div v-if="i < steps.length - 1" class="ml-[1.375rem] w-px h-3 bg-border shrink-0" />
    </template>
  </nav>
</template>
