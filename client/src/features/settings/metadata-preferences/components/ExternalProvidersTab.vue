<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ProviderStatus } from '@bookorbit/types'
import BuildYourOwnProviderCard from './BuildYourOwnProviderCard.vue'
import ExternalProvidersPanel from './ExternalProvidersPanel.vue'
import MovedProvidersNotice from './MovedProvidersNotice.vue'
import ProviderDirectoryPanel from './ProviderDirectoryPanel.vue'

defineProps<{ statuses: ProviderStatus[] }>()

const emit = defineEmits<{ changed: [] }>()

const { t } = useI18n()

const panel = ref<InstanceType<typeof ExternalProvidersPanel> | null>(null)
const registeredKeys = computed(() => panel.value?.registeredKeys ?? [])

function handleChanged() {
  emit('changed')
}

function handleAdd(prefill: { baseUrl: string; allowPrivateAddress: boolean }) {
  panel.value?.openCreate(prefill)
}
</script>

<template>
  <div class="space-y-6">
    <p class="max-w-3xl text-sm leading-relaxed text-muted-foreground">{{ t('settings.metadata.externalProviders.description') }}</p>
    <MovedProvidersNotice :statuses="statuses" />
    <ExternalProvidersPanel ref="panel" @changed="handleChanged" />
    <ProviderDirectoryPanel :registered-keys="registeredKeys" @add="handleAdd" />
    <BuildYourOwnProviderCard />
  </div>
</template>
