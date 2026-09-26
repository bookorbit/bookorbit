<script setup lang="ts">
import { ref } from 'vue'
import { Loader2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SECRET_INPUT_ATTRS } from '@/lib/secret-input'
import * as ttsApi from '../api/tts.api'
import type { TtsDbProvider } from '../api/tts.api'

const props = defineProps<{ provider?: TtsDbProvider }>()

const emit = defineEmits<{ saved: [provider: TtsDbProvider]; cancel: [] }>()

const { t } = useI18n()

const isEdit = props.provider !== undefined
const name = ref(props.provider?.name ?? '')
const baseUrl = ref(props.provider?.baseUrl ?? '')
// The stored key is never sent back to the browser in full, so an empty field on edit means
// "unchanged" rather than "clear it".
const apiKey = ref('')
const defaultModel = ref(props.provider?.defaultModel ?? '')
const supportsVoiceDiscovery = ref(props.provider?.supportsVoiceDiscovery ?? true)
const saving = ref(false)

async function handleSubmit() {
  if (!name.value.trim() || !baseUrl.value.trim()) {
    toast.error(t('settings.admin.tts.formRequired'))
    return
  }
  saving.value = true
  try {
    const payload = {
      name: name.value.trim(),
      baseUrl: baseUrl.value.trim(),
      defaultModel: defaultModel.value.trim(),
      supportsVoiceDiscovery: supportsVoiceDiscovery.value,
      ...(apiKey.value.trim() ? { apiKey: apiKey.value.trim() } : {}),
    }
    const saved = props.provider ? await ttsApi.updateProvider(props.provider.id, payload) : await ttsApi.addProvider(payload)
    toast.success(t('settings.admin.tts.saved'))
    emit('saved', saved)
  } catch {
    toast.error(t('settings.admin.tts.saveFailed', { name: name.value.trim() }))
  } finally {
    saving.value = false
  }
}

function handleCancel() {
  emit('cancel')
}
</script>

<template>
  <form class="rounded-xl border border-border bg-card p-5" @submit.prevent="handleSubmit">
    <h3 class="font-semibold text-foreground">
      {{ isEdit ? t('settings.admin.tts.formEditTitle') : t('settings.admin.tts.formAddTitle') }}
    </h3>

    <div class="mt-4 grid gap-4 sm:grid-cols-2">
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-muted-foreground" for="tts-provider-name">{{ t('settings.admin.tts.formName') }}</label>
        <Input id="tts-provider-name" v-model="name" :placeholder="t('settings.admin.tts.formNamePlaceholder')" required />
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-muted-foreground" for="tts-provider-url">{{ t('settings.admin.tts.formBaseUrl') }}</label>
        <Input id="tts-provider-url" v-model="baseUrl" type="url" :placeholder="t('settings.admin.tts.formBaseUrlPlaceholder')" required />
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-muted-foreground" for="tts-provider-key">
          {{ t('settings.admin.tts.formApiKey') }}
          <span class="font-normal">({{ t('settings.admin.tts.formApiKeyOptional') }})</span>
        </label>
        <Input
          id="tts-provider-key"
          v-model="apiKey"
          v-bind="SECRET_INPUT_ATTRS"
          type="text"
          class="input-secret"
          :placeholder="t('settings.admin.tts.formApiKeyPlaceholder')"
        />
        <p v-if="isEdit" class="text-xs text-muted-foreground">{{ t('settings.admin.tts.formApiKeyKeep') }}</p>
      </div>
      <div class="space-y-1.5">
        <label class="text-xs font-medium text-muted-foreground" for="tts-provider-model">{{ t('settings.admin.tts.formModel') }}</label>
        <Input id="tts-provider-model" v-model="defaultModel" :placeholder="t('settings.admin.tts.formModelPlaceholder')" />
      </div>
    </div>

    <label class="mt-4 flex items-center gap-2 text-sm text-foreground">
      <input v-model="supportsVoiceDiscovery" type="checkbox" class="size-4 rounded border-border accent-primary" />
      {{ t('settings.admin.tts.formDiscovery') }}
    </label>

    <div class="mt-5 flex items-center gap-2">
      <Button type="submit" :disabled="saving">
        <Loader2 v-if="saving" class="size-4 animate-spin" />
        {{ t('common.save') }}
      </Button>
      <Button type="button" variant="outline" :disabled="saving" @click="handleCancel">{{ t('common.cancel') }}</Button>
    </div>
  </form>
</template>
