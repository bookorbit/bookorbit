<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { useEmailPreferences } from '../composables/useEmailPreferences'
import { useEmailProviders } from '../composables/useEmailProviders'
import { useEmailRecipients } from '../composables/useEmailRecipients'
import { useEmailTemplates } from '../composables/useEmailTemplates'

const { t } = useI18n()
const { preferences, fetchPreferences, savePreferences } = useEmailPreferences()
const { providers } = useEmailProviders()
const { recipients } = useEmailRecipients()
const { templates } = useEmailTemplates()

const defaultProviderId = ref<number | null>(null)
const defaultRecipientId = ref<number | null>(null)
const defaultTemplateId = ref<number | null>(null)
const saving = ref(false)

onMounted(async () => {
  await fetchPreferences()
  defaultProviderId.value = preferences.value?.defaultProviderId ?? null
  defaultRecipientId.value = preferences.value?.defaultRecipientId ?? null
  defaultTemplateId.value = preferences.value?.defaultTemplateId ?? null
})

async function save() {
  saving.value = true
  try {
    await savePreferences({
      defaultProviderId: defaultProviderId.value,
      defaultRecipientId: defaultRecipientId.value,
      defaultTemplateId: defaultTemplateId.value,
    })
    toast.success(t('email.preferences.saved'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('email.saveFailed'))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-5">
    <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{{ t('email.preferences.heading') }}</p>

    <div class="border border-border rounded-lg p-4 md:p-5 bg-card space-y-5">
      <div>
        <label class="block text-sm font-medium text-foreground mb-1">{{ t('email.preferences.defaultProvider') }}</label>
        <p class="text-xs text-muted-foreground mb-2">{{ t('email.preferences.defaultProviderHint') }}</p>
        <select
          v-model="defaultProviderId"
          class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option :value="null">{{ t('email.preferences.noneAccountDefault') }}</option>
          <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }} ({{ p.host }})</option>
        </select>
      </div>

      <div>
        <label class="block text-sm font-medium text-foreground mb-1">{{ t('email.preferences.defaultRecipient') }}</label>
        <p class="text-xs text-muted-foreground mb-2">{{ t('email.preferences.defaultRecipientHint') }}</p>
        <select
          v-model="defaultRecipientId"
          class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option :value="null">{{ t('email.preferences.none') }}</option>
          <option v-for="r in recipients" :key="r.id" :value="r.id">{{ r.name }} ({{ r.email }})</option>
        </select>
      </div>

      <div>
        <label class="block text-sm font-medium text-foreground mb-1">{{ t('email.preferences.defaultTemplate') }}</label>
        <p class="text-xs text-muted-foreground mb-2">{{ t('email.preferences.defaultTemplateHint') }}</p>
        <select
          v-model="defaultTemplateId"
          class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option :value="null">{{ t('email.preferences.noneSystemDefault') }}</option>
          <option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
      </div>

      <button
        class="hidden md:inline-flex px-4 py-2 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        :disabled="saving"
        @click="save()"
      >
        {{ saving ? t('email.saving') : t('email.preferences.save') }}
      </button>
      <div class="md:hidden sticky bottom-2 z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2">
        <button class="settings-btn-primary w-full min-h-10 justify-center" :disabled="saving" @click="save()">
          {{ saving ? t('email.saving') : t('email.preferences.save') }}
        </button>
      </div>
    </div>
  </div>
</template>
