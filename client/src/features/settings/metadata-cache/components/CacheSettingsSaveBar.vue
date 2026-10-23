<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, Save } from '@lucide/vue'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  dirty: boolean
  invalid: boolean
  saving: boolean
}>()

const emit = defineEmits<{ save: []; discard: [] }>()

const { t } = useI18n()

const canSave = computed(() => props.dirty && !props.invalid && !props.saving)
const statusText = computed(() => {
  if (props.invalid) return t('settings.metadata.searchCache.save.invalid')
  if (props.dirty) return t('settings.metadata.searchCache.save.unsaved')
  return t('settings.metadata.searchCache.save.upToDate')
})

const statusClass = computed(() => {
  if (props.invalid) return 'text-destructive'
  return props.dirty ? 'text-foreground' : 'text-muted-foreground'
})

function handleSave() {
  emit('save')
}

function handleDiscard() {
  emit('discard')
}
</script>

<template>
  <div
    class="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2.5 backdrop-blur"
    :class="dirty ? 'border-primary/30 bg-primary/10' : 'border-border bg-card/90 supports-[backdrop-filter]:bg-card/75'"
  >
    <p class="flex items-center gap-2 text-sm" :class="statusClass" role="status">
      <span v-if="dirty" class="size-2 shrink-0 rounded-full" :class="invalid ? 'bg-destructive' : 'bg-primary'" aria-hidden="true" />
      {{ statusText }}
    </p>
    <div class="ms-auto flex items-center gap-2">
      <Button variant="ghost" size="sm" type="button" :disabled="!dirty || saving" @click="handleDiscard">
        {{ t('settings.metadata.searchCache.save.discard') }}
      </Button>
      <Button size="sm" type="button" :disabled="!canSave" data-testid="metadata-cache-save" @click="handleSave">
        <Loader2 v-if="saving" class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <Save v-else class="size-3.5" aria-hidden="true" />
        {{ t('settings.metadata.searchCache.save.action') }}
      </Button>
    </div>
  </div>
</template>
