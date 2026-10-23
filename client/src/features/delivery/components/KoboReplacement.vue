<script setup lang="ts">
import { computed, onScopeDispose, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import type { KoboDevice, ReadAloudDeliveryPreference } from '@bookorbit/types'
import { formatBytes } from '@/lib/formatting'
import { useGlobalSearch } from '@/features/book/composables/useGlobalSearch'
import { useKoboReplacement } from '../composables/useKoboReplacement'
import ReadAloudDeliverySelect from './ReadAloudDeliverySelect.vue'

const props = defineProps<{ devices: KoboDevice[] }>()
const { t } = useI18n()
const id = useId()
const deviceId = ref<number | null>(null)
const bookId = ref<number | null>(null)
const variant = ref<ReadAloudDeliveryPreference>('audioless_epub')
const query = ref('')
watch(query, () => {
  bookId.value = null
})
const { results, loading, settled, hasMore, loadMore, clear } = useGlobalSearch(query)
onScopeDispose(clear)
const { replacement, busy, failed, alreadyOnDevice, prepare, transition, refresh } = useKoboReplacement(deviceId, bookId)
const locked = computed(() => busy.value || (!!replacement.value && !['cancelled', 'user_confirmed'].includes(replacement.value.state)))
const status = computed(() => {
  if (!replacement.value) return alreadyOnDevice.value ? t('delivery.readAloud.alreadyOnDevice') : ''
  if (replacement.value.state === 'prepared')
    return t('delivery.readAloud.prepared', {
      format: replacement.value.metadata.format.toUpperCase(),
      size: formatBytes(replacement.value.metadata.sizeBytes),
    })
  if (replacement.value.state === 'cancelled') return t('delivery.readAloud.cancelled')
  if (replacement.value.state === 'user_confirmed') return t('delivery.readAloud.confirmed')
  if (replacement.value.state === 'transfer_observed') return t('delivery.readAloud.transferred')
  return t('delivery.readAloud.offered')
})
async function handlePrepare() {
  if (deviceId.value && bookId.value && variant.value) await prepare(variant.value)
}
async function handleOffer() {
  if (deviceId.value) await transition('offer')
}
async function handleConfirm() {
  if (deviceId.value) await transition('confirm')
}
async function handleCancel() {
  if (deviceId.value) await transition('cancel')
}
</script>

<template>
  <section v-if="props.devices.length" class="rounded-xs border border-border bg-card p-5 space-y-4">
    <h3 class="font-medium text-foreground">{{ t('delivery.readAloud.replacementTitle') }}</h3>
    <p class="text-sm text-muted-foreground">{{ t('delivery.readAloud.replacementHint') }}</p>
    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <label :for="`${id}-device`" class="block text-sm text-foreground">{{ t('delivery.readAloud.device') }}</label>
        <select :id="`${id}-device`" v-model="deviceId" :disabled="locked" class="select-field w-full text-foreground">
          <option v-for="device in devices" :key="device.id" :value="device.id">{{ device.name }}</option>
        </select>
      </div>
      <div>
        <label :for="`${id}-book`" class="block text-sm text-foreground">{{ t('delivery.readAloud.searchBook') }}</label>
        <input
          :id="`${id}-book`"
          v-model="query"
          type="search"
          :disabled="locked"
          class="input-field w-full text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
        <label :for="`${id}-result`" class="block text-sm text-foreground">{{ t('delivery.readAloud.chooseBook') }}</label>
        <select
          :id="`${id}-result`"
          v-model="bookId"
          :disabled="locked"
          class="select-field w-full text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option :value="null">{{ t('delivery.readAloud.chooseBook') }}</option>
          <option v-for="book in results" :key="book.id" :value="book.id">{{ book.title }}</option>
        </select>
        <p v-if="loading" role="status" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>
        <p v-else-if="settled && !results.length" role="status" class="text-sm text-muted-foreground">{{ t('delivery.readAloud.noResults') }}</p>
        <Button v-if="hasMore" variant="outline" :disabled="loading || locked" @click="loadMore">{{ t('delivery.readAloud.moreResults') }}</Button>
      </div>
    </div>
    <ReadAloudDeliverySelect v-model="variant" explicit-only :disabled="locked" />
    <p role="status" class="text-sm text-muted-foreground">{{ status }}</p>
    <p v-if="failed" role="alert" class="text-sm text-destructive">{{ t('delivery.readAloud.failed') }}</p>
    <div class="flex flex-wrap gap-2">
      <Button v-if="!locked" :disabled="busy || !deviceId || !bookId || !variant" @click="handlePrepare">{{
        t('delivery.readAloud.prepare')
      }}</Button>
      <Button v-if="replacement?.state === 'prepared'" :disabled="busy" @click="handleOffer">{{ t('delivery.readAloud.offer') }}</Button>
      <Button v-if="replacement && replacement.state === 'transfer_observed'" :disabled="busy" @click="handleConfirm">{{
        t('delivery.readAloud.confirm')
      }}</Button>
      <Button v-if="replacement" variant="outline" :disabled="busy" @click="refresh">{{ t('delivery.readAloud.refresh') }}</Button>
      <Button v-if="locked" variant="outline" :disabled="busy" @click="handleCancel">{{ t('delivery.readAloud.cancel') }}</Button>
    </div>
  </section>
</template>
