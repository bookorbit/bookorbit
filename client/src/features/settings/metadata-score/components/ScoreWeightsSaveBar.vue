<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, Save } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/i18n/formatters'

const { t } = useI18n()

const props = defineProps<{
  dirty: boolean
  changedCount: number
  total: number
  savedTotal: number
  totalBooks: number
  saving?: boolean
  readOnly?: boolean
}>()

const emit = defineEmits<{ save: []; discard: [] }>()

const canSave = computed(() => props.dirty && !props.saving && !props.readOnly)

const consequence = computed(() =>
  props.totalBooks > 0
    ? t('settings.admin.scoreWeights.save.rescores', { count: props.totalBooks })
    : t('settings.admin.scoreWeights.save.rescoresUnknown'),
)

function save() {
  emit('save')
}

function discard() {
  emit('discard')
}
</script>

<template>
  <div
    class="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-t px-4 py-2.5 backdrop-blur md:px-6"
    :class="
      dirty
        ? 'border-primary/30 bg-primary/10 supports-[backdrop-filter]:bg-primary/10'
        : 'border-border bg-card/90 supports-[backdrop-filter]:bg-card/75'
    "
  >
    <div v-if="dirty" class="min-w-0" role="status">
      <p class="flex items-center gap-2 text-sm font-medium text-foreground">
        <span class="size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
        {{ t('settings.admin.scoreWeights.save.unsaved', { count: changedCount }) }}
        <span class="text-muted-foreground tabular-nums">
          {{ t('settings.admin.scoreWeights.save.totalShift', { from: formatNumber(savedTotal), to: formatNumber(total) }) }}
        </span>
      </p>
      <p class="mt-0.5 text-xs text-muted-foreground">{{ consequence }}</p>
    </div>
    <p v-else class="text-sm text-muted-foreground" role="status">{{ t('settings.admin.scoreWeights.save.upToDate') }}</p>

    <div class="ml-auto flex items-center gap-2">
      <Button variant="ghost" size="sm" type="button" :disabled="!dirty || saving" @click="discard">
        {{ t('settings.admin.scoreWeights.save.discard') }}
      </Button>
      <Button size="sm" type="button" :disabled="!canSave" @click="save">
        <Loader2 v-if="saving" :size="14" class="animate-spin" />
        <Save v-else :size="14" />
        {{ t('settings.admin.scoreWeights.save.action') }}
      </Button>
    </div>
  </div>
</template>
