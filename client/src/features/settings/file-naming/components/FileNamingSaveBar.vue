<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleCheck, Loader2, Save } from '@lucide/vue'
import { Button } from '@/components/ui/button'

const props = defineProps<{
  unsavedCount: number
  saving: boolean
  /** Set while a dirty rule has a validation error, so Save cannot send a bad pattern. */
  blocked: boolean
}>()

const emit = defineEmits<{ save: []; discard: [] }>()

const { t } = useI18n()

const dirty = computed(() => props.unsavedCount > 0)
const canSave = computed(() => dirty.value && !props.saving && !props.blocked)

function handleSave() {
  emit('save')
}

function handleDiscard() {
  emit('discard')
}
</script>

<template>
  <div
    class="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-border bg-card/90 px-3.5 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-card/75 md:px-5"
  >
    <p v-if="blocked && dirty" class="flex items-center gap-2 text-sm text-destructive" role="status">
      <span aria-hidden="true" class="size-2 shrink-0 rounded-full bg-destructive" />
      {{ t('settings.reader.fileNaming.save.blocked') }}
    </p>
    <p v-else-if="dirty" class="flex items-center gap-2 text-sm text-foreground" role="status">
      <span aria-hidden="true" class="size-2 shrink-0 rounded-full bg-warning" />
      {{ t('settings.reader.fileNaming.save.unsaved', { count: unsavedCount }) }}
    </p>
    <p v-else class="flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <CircleCheck :size="14" class="shrink-0" aria-hidden="true" />
      {{ t('settings.reader.fileNaming.save.upToDate') }}
    </p>

    <div class="ml-auto flex items-center gap-2">
      <Button variant="ghost" size="sm" type="button" :disabled="!dirty || saving" @click="handleDiscard">
        {{ t('settings.reader.fileNaming.save.discard') }}
      </Button>
      <Button size="sm" type="button" :disabled="!canSave" @click="handleSave">
        <Loader2 v-if="saving" :size="14" class="animate-spin" aria-hidden="true" />
        <Save v-else :size="14" aria-hidden="true" />
        {{ t('settings.reader.fileNaming.save.action') }}
      </Button>
    </div>
  </div>
</template>
