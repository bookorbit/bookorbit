<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { toast } from 'vue-sonner'
import { useEmailPreferences } from '../composables/useEmailPreferences'
import { useEmailProviders } from '../composables/useEmailProviders'
import { useEmailRecipients } from '../composables/useEmailRecipients'
import { useEmailTemplates } from '../composables/useEmailTemplates'

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
    toast.success('Preferences saved')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to save')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="space-y-5">
    <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email Preferences</p>

    <div class="border border-border rounded-lg p-4 md:p-5 bg-card space-y-5">
      <div>
        <label class="block text-sm font-medium text-foreground mb-1">Default provider</label>
        <p class="text-xs text-muted-foreground mb-2">Used when no provider is specified. If empty, the account default is used.</p>
        <select
          v-model="defaultProviderId"
          class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option :value="null">None (use account default)</option>
          <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }} ({{ p.host }})</option>
        </select>
      </div>

      <div>
        <label class="block text-sm font-medium text-foreground mb-1">Default recipient</label>
        <p class="text-xs text-muted-foreground mb-2">Used for quick send. Must be set to use the quick-send action on book cards.</p>
        <select
          v-model="defaultRecipientId"
          class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option :value="null">None</option>
          <option v-for="r in recipients" :key="r.id" :value="r.id">{{ r.name }} ({{ r.email }})</option>
        </select>
      </div>

      <div>
        <label class="block text-sm font-medium text-foreground mb-1">Default template</label>
        <p class="text-xs text-muted-foreground mb-2">Used when no template is specified. Falls back to the system default if empty.</p>
        <select
          v-model="defaultTemplateId"
          class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option :value="null">None (use system default)</option>
          <option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</option>
        </select>
      </div>

      <button
        class="hidden md:inline-flex px-4 py-2 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        :disabled="saving"
        @click="save()"
      >
        {{ saving ? 'Saving...' : 'Save preferences' }}
      </button>
      <div class="md:hidden sticky bottom-2 z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2">
        <button class="settings-btn-primary w-full min-h-10 justify-center" :disabled="saving" @click="save()">
          {{ saving ? 'Saving...' : 'Save preferences' }}
        </button>
      </div>
    </div>
  </div>
</template>
