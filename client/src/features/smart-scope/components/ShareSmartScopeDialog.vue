<script setup lang="ts">
import { onMounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { Copy, Download } from '@lucide/vue'
import type { SmartScope } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { copyToClipboard } from '@/lib/clipboard'
import { triggerBlobDownload } from '@/lib/download'
import { resolveLucideIconFile } from '@/lib/lucide-icons'
import { createShareText } from '../composables/useSmartScopeTransfer'
import { ScopeTransferError } from '../lib/smart-scope-transfer'
import SmartScopeTransferDialog from './SmartScopeTransferDialog.vue'

const props = defineProps<{ scope: SmartScope }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const textId = useId()
const shareText = ref('')
const loading = ref(true)
const error = ref('')
const copyStatus = ref('')

function close() {
  emit('close')
}

async function load() {
  try {
    shareText.value = await createShareText(props.scope)
  } catch (cause) {
    error.value = cause instanceof ScopeTransferError ? cause.code : 'catalogFailed'
  } finally {
    loading.value = false
  }
}

async function copy() {
  copyStatus.value = (await copyToClipboard(shareText.value)) ? 'copied' : 'copyFailed'
}

function download() {
  triggerBlobDownload(new Blob([shareText.value], { type: 'application/json' }), 'bookorbit-smart-scope.json')
}

onMounted(load)
</script>

<template>
  <SmartScopeTransferDialog
    :title="t('smartScope.transfer.shareTitle', { name: scope.name })"
    :description="t('smartScope.transfer.shareDescription')"
    @close="close"
  >
    <p v-if="loading" role="status" class="text-sm text-muted-foreground">{{ t('smartScope.transfer.preparing') }}</p>
    <p v-else-if="error" role="alert" class="text-sm text-destructive">{{ t(`smartScope.transfer.${error}`) }}</p>
    <template v-else>
      <p class="mb-3 text-sm text-muted-foreground">{{ t('smartScope.transfer.shareReminder') }}</p>
      <p v-if="scope.icon && !resolveLucideIconFile(scope.icon)" class="mb-3 text-sm text-muted-foreground">
        {{ t('smartScope.transfer.iconFallback') }}
      </p>
      <label :for="textId" class="mb-1.5 block text-sm font-medium text-foreground">{{ t('smartScope.transfer.templateText') }}</label>
      <textarea
        :id="textId"
        :value="shareText"
        dir="ltr"
        readonly
        rows="7"
        spellcheck="false"
        class="block w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <p v-if="copyStatus" role="status" class="mt-2 text-sm text-muted-foreground">{{ t(`smartScope.transfer.${copyStatus}`) }}</p>
    </template>
    <template #actions>
      <Button type="button" variant="outline" :disabled="!shareText" @click="download">
        <Download aria-hidden="true" />
        {{ t('smartScope.transfer.download') }}
      </Button>
      <Button type="button" :disabled="!shareText" @click="copy">
        <Copy aria-hidden="true" />
        {{ t('smartScope.transfer.copy') }}
      </Button>
    </template>
  </SmartScopeTransferDialog>
</template>
