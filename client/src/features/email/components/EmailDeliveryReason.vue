<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import type { EmailSendLogEntry } from '@bookorbit/types'

import { useDeliveryWords } from '../composables/useDeliveryWords'

const props = defineProps<{
  entry: EmailSendLogEntry
  /** The server it went through, to name it in the sentence. */
  serverName?: string | null
  serverHost?: string | null
}>()

const { t } = useI18n()
const rawId = useId()
const showRaw = ref(false)

const { lead: leadOf, fix: fixOf } = useDeliveryWords()
const lead = computed(() => leadOf(props.entry, props.serverName, props.serverHost))
const fix = computed(() => fixOf(props.entry))

function toggleRaw() {
  showRaw.value = !showRaw.value
}
</script>

<template>
  <div v-if="lead" class="min-w-0 text-[12.5px] leading-normal">
    <p class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span class="text-foreground">{{ lead }}</span>
      <span v-if="fix" class="text-muted-foreground">{{ fix }}</span>
      <button
        v-if="entry.errorMessage"
        type="button"
        class="text-xs text-muted-foreground underline decoration-dotted underline-offset-[3px] hover:text-foreground"
        :aria-expanded="showRaw"
        :aria-controls="rawId"
        @click="toggleRaw"
      >
        {{ t('email.reason.serverMessage') }}
      </button>
    </p>
    <p v-if="showRaw" :id="rawId" class="mt-1 break-words font-mono text-[11.5px] text-muted-foreground">{{ entry.errorMessage }}</p>
  </div>
</template>
