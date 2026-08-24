<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'
import { Loader2, Save } from '@lucide/vue'
import { Button } from '@/components/ui/button'

const { t } = useI18n()

const props = defineProps<{
  dirty: boolean
  unsavedCount: number
  scopeName: string
  saving?: boolean
  /** Set while another part of the form is invalid, so Save cannot send a bad value. */
  blocked?: boolean
}>()

const canSave = computed(() => props.dirty && !props.saving && !props.blocked)

const emit = defineEmits<{ save: []; discard: [] }>()

function save() {
  emit('save')
}

function discard() {
  emit('discard')
}
</script>

<template>
  <div
    class="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-border bg-card/90 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-card/75 md:px-6"
  >
    <p v-if="dirty" class="flex items-center gap-2 text-sm text-foreground" role="status">
      <span class="size-2 shrink-0 rounded-full bg-warning" aria-hidden="true" />
      {{ t('settings.metadata.fieldRules.save.unsaved', { count: unsavedCount, scope: scopeName }) }}
    </p>
    <p v-else class="text-sm text-muted-foreground" role="status">{{ t('settings.metadata.fieldRules.save.upToDate') }}</p>

    <div class="ml-auto flex items-center gap-2">
      <Button variant="ghost" size="sm" type="button" :disabled="!dirty || saving" @click="discard">
        {{ t('settings.metadata.fieldRules.save.discard') }}
      </Button>
      <Button size="sm" type="button" :disabled="!canSave" @click="save">
        <Loader2 v-if="saving" :size="14" class="animate-spin" />
        <Save v-else :size="14" />
        {{ t('settings.metadata.fieldRules.save.action', { scope: scopeName }) }}
      </Button>
    </div>
  </div>
</template>
