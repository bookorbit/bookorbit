<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import type { RowStep } from '../requestSelection'

/**
 * The one thing due next on a row, in one size and one style whatever it is, so the column reads
 * as a column. Nothing due renders nothing; the row itself opens the request.
 */
const props = defineProps<{
  step: RowStep
  busy: boolean
}>()

const emit = defineEmits<{ press: [step: RowStep] }>()

const { t } = useI18n()

const label = computed(() => {
  const both = props.step.halves.length > 1
  if (props.step.kind === 'approve') return t(both ? 'bookRequests.nextStep.approveBoth' : 'bookRequests.nextStep.approve')
  if (props.step.kind === 'pick') return t(both ? 'bookRequests.nextStep.pickBoth' : 'bookRequests.nextStep.pick')
  return t('bookRequests.nextStep.review')
})

function handlePress() {
  emit('press', props.step)
}
</script>

<template>
  <Button
    variant="outline"
    size="sm"
    class="min-w-0 px-2.5 text-[13px]"
    :class="step.kind === 'approve' && 'border-primary/40 text-primary hover:bg-primary/10 hover:text-primary'"
    :disabled="busy"
    :title="label"
    @click="handlePress"
  >
    <span class="truncate">{{ label }}</span>
  </Button>
</template>
