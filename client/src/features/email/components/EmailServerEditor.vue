<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { AlertTriangle, Loader2, Lock, PlugZap } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import ConnectionHealth from '@/features/settings/ConnectionHealth.vue'
import SettingsEditorSheet from '@/features/settings/components/SettingsEditorSheet.vue'
import SettingsField from '@/features/settings/components/SettingsField.vue'
import SettingsSection from '@/features/settings/components/SettingsSection.vue'
import SettingsToggleField from '@/features/settings/components/SettingsToggleField.vue'
import type { EditorMenuAction } from '@/features/settings/lib/editor-actions'
import { SECRET_INPUT_ATTRS } from '@/lib/secret-input'
import EmailSegmented, { type SegmentOption } from './EmailSegmented.vue'
import { useEmailProviders, type EmailProvider, type EmailProviderForm } from '../composables/useEmailProviders'
import { useEmailPreferences } from '../composables/useEmailPreferences'

const props = defineProps<{
  open: boolean
  /** Null to add one. */
  provider: EmailProvider | null
  isDefault: boolean
  isSuperuser: boolean
}>()

const emit = defineEmits<{ 'update:open': [open: boolean]; saved: [provider: EmailProvider] }>()

const { t } = useI18n()
const { createProvider, updateProvider, deleteProvider, testProvider, toggleSharedProvider, setSystemProvider, clearSystemProvider } =
  useEmailProviders()
const { savePreferences } = useEmailPreferences()

type Security = 'starttls' | 'ssl' | 'none'
type Preset = 'gmail' | 'outlook' | 'icloud' | 'fastmail' | 'other'

const PRESETS: Record<Exclude<Preset, 'other'>, { host: string; port: number; security: Security; name: string }> = {
  gmail: { host: 'smtp.gmail.com', port: 587, security: 'starttls', name: 'Gmail' },
  outlook: { host: 'smtp-mail.outlook.com', port: 587, security: 'starttls', name: 'Outlook' },
  icloud: { host: 'smtp.mail.me.com', port: 587, security: 'starttls', name: 'iCloud Mail' },
  fastmail: { host: 'smtp.fastmail.com', port: 465, security: 'ssl', name: 'Fastmail' },
}

interface Draft {
  name: string
  host: string
  port: number
  security: Security
  auth: boolean
  username: string
  password: string
  fromName: string
  fromAddress: string
  shared: boolean
  system: boolean
  verifyTls: boolean
}

const draft = reactive<Draft>(blank())
const initial = ref('')
const saving = ref(false)
const testing = ref(false)
const passwordVisible = ref(false)
const error = ref<string | null>(null)

function blank(): Draft {
  const gmail = PRESETS.gmail
  return {
    name: gmail.name,
    host: gmail.host,
    port: gmail.port,
    security: gmail.security,
    auth: true,
    username: '',
    password: '',
    fromName: '',
    fromAddress: '',
    shared: false,
    system: false,
    verifyTls: true,
  }
}

/** Both flags set is the old form's contradiction; the transport treats it as SSL, so does the editor. */
function securityOf(p: EmailProvider): Security {
  if (p.ssl) return 'ssl'
  return p.startTls ? 'starttls' : 'none'
}

function fromProvider(p: EmailProvider): Draft {
  return {
    name: p.name,
    host: p.host,
    port: p.port,
    security: securityOf(p),
    auth: p.auth,
    username: p.username ?? '',
    password: '',
    fromName: p.fromName ?? '',
    fromAddress: p.fromAddress ?? '',
    shared: p.isShared,
    system: p.isSystemProvider,
    verifyTls: p.tlsRejectUnauthorized,
  }
}

watch(
  () => [props.open, props.provider] as const,
  ([open]) => {
    if (!open) return
    Object.assign(draft, props.provider ? fromProvider(props.provider) : blank())
    initial.value = JSON.stringify(draft)
    passwordVisible.value = false
    error.value = null
  },
  { immediate: true },
)

const dirty = computed(() => JSON.stringify(draft) !== initial.value)
const title = computed(() => props.provider?.name || t('email.editor.server.newTitle'))
const preset = computed<Preset>(() => {
  const match = (Object.keys(PRESETS) as (keyof typeof PRESETS)[]).find((key) => PRESETS[key].host === draft.host.trim().toLowerCase())
  return match ?? 'other'
})
const needsAppPassword = computed(() => preset.value === 'gmail' || preset.value === 'icloud')

const presetOptions = computed<SegmentOption[]>(() => [
  { value: 'gmail', label: t('email.editor.server.presetGmail') },
  { value: 'outlook', label: t('email.editor.server.presetOutlook') },
  { value: 'icloud', label: t('email.editor.server.presetIcloud') },
  { value: 'fastmail', label: t('email.editor.server.presetFastmail') },
  { value: 'other', label: t('email.editor.server.presetOther') },
])
const securityOptions = computed<SegmentOption[]>(() => [
  { value: 'starttls', label: t('email.editor.server.securityStarttls'), icon: Lock },
  { value: 'ssl', label: t('email.editor.server.securitySsl'), icon: Lock },
  { value: 'none', label: t('email.editor.server.securityNone') },
])

const menuActions = computed<EditorMenuAction[]>(() =>
  props.provider && !props.isDefault ? [{ id: 'make-default', label: t('email.editor.server.makeDefault') }] : [],
)
const testLabel = computed(() => (dirty.value ? t('email.editor.server.testDirty') : t('email.editor.server.test')))

function applyPreset(next: string | null) {
  const value = (next ?? 'other') as Preset
  if (value === 'other') {
    if (preset.value !== 'other') draft.host = ''
    return
  }
  const p = PRESETS[value]
  const previous = preset.value === 'other' ? null : PRESETS[preset.value]
  if (!draft.name.trim() || draft.name === previous?.name) draft.name = p.name
  draft.host = p.host
  draft.port = p.port
  draft.security = p.security
  draft.auth = true
}
function setSecurity(next: string | null) {
  const value = (next ?? 'none') as Security
  draft.security = value
  if (value === 'ssl' && draft.port === 587) draft.port = 465
  if (value === 'starttls' && draft.port === 465) draft.port = 587
}
function togglePasswordVisible() {
  passwordVisible.value = !passwordVisible.value
}
function setAuth(value: boolean) {
  draft.auth = value
}
function setShared(value: boolean) {
  draft.shared = value
}
function setSystem(value: boolean) {
  draft.system = value
}
function setVerifyTls(value: boolean) {
  draft.verifyTls = value
}
function close() {
  emit('update:open', false)
}

function toForm(): EmailProviderForm {
  return {
    name: draft.name.trim(),
    host: draft.host.trim(),
    port: Number(draft.port),
    username: draft.username.trim(),
    password: draft.password,
    fromName: draft.fromName.trim(),
    fromAddress: draft.fromAddress.trim(),
    auth: draft.auth,
    ssl: draft.security === 'ssl',
    startTls: draft.security === 'starttls',
    tlsRejectUnauthorized: draft.verifyTls,
  }
}

async function handleSave() {
  if (!draft.name.trim() || !draft.host.trim()) {
    error.value = t('email.editor.server.required')
    return
  }
  saving.value = true
  error.value = null
  try {
    const form = toForm()
    let saved: EmailProvider
    if (props.provider) {
      const patch: Partial<EmailProviderForm> = { ...form }
      if (!patch.password) delete patch.password
      saved = await updateProvider(props.provider.id, patch)
    } else {
      saved = await createProvider(form)
    }
    if (saved.isShared !== draft.shared) await toggleSharedProvider(saved.id)
    if (props.isSuperuser && saved.isSystemProvider !== draft.system) {
      if (draft.system) await setSystemProvider(saved.id)
      else await clearSystemProvider()
    }
    toast.success(props.provider ? t('email.providers.updated') : t('email.providers.created'))
    emit('saved', saved)
    close()
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('email.saveFailed')
  } finally {
    saving.value = false
  }
}

async function handleRemove() {
  if (!props.provider) return
  saving.value = true
  try {
    await deleteProvider(props.provider.id)
    toast.success(t('email.providers.deleted', { name: props.provider.name }))
    close()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('email.deleteFailed'))
  } finally {
    saving.value = false
  }
}

async function handleAction(id: string) {
  if (id !== 'make-default' || !props.provider) return
  try {
    await savePreferences({ defaultProviderId: props.provider.id })
    toast.success(t('email.route.defaultSaved'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('email.setDefaultFailed'))
  }
}

async function handleTest() {
  if (!props.provider || dirty.value) return
  testing.value = true
  try {
    const result = await testProvider(props.provider.id)
    if (result.success) toast.success(t('email.editor.server.testOk'))
    else toast.error(t('email.editor.server.testFailed', { error: result.error ?? '' }))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('email.providers.testFailed'))
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <SettingsEditorSheet
    :open="open"
    :title="title"
    :description="t('email.editor.server.description')"
    :dirty="dirty"
    :busy="saving"
    :removable="provider !== null && !provider.isSystemProvider"
    :remove-label="t('email.editor.server.remove')"
    :remove-confirm="t('email.editor.server.removeConfirm', { name: provider?.name ?? '' })"
    :remove-consequence="provider?.isShared ? t('email.editor.server.removeConsequence') : undefined"
    :menu-actions="menuActions"
    @save="handleSave"
    @cancel="close"
    @remove="handleRemove"
    @action="handleAction"
  >
    <template #badge>
      <span v-if="isDefault" class="rounded-xs bg-primary/15 px-1.5 text-[10px] leading-[18px] font-semibold text-primary">{{
        t('email.badge.default')
      }}</span>
    </template>
    <template #status>
      <div v-if="provider" class="flex flex-col gap-1">
        <ConnectionHealth :last-tested-at="provider.lastTestedAt ?? null" :last-test-ok="provider.lastTestOk ?? null" :enabled="true" />
        <p v-if="provider.lastTestOk === false && provider.lastTestError" class="font-mono text-[11.5px] break-words text-destructive">
          {{ provider.lastTestError }}
        </p>
      </div>
    </template>
    <template #actions>
      <Button v-if="provider" variant="outline" size="sm" :disabled="testing || dirty" :title="testLabel" :aria-label="testLabel" @click="handleTest">
        <Loader2 v-if="testing" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <PlugZap v-else :size="14" aria-hidden="true" />
        <span class="max-sm:sr-only">{{ t('email.editor.server.test') }}</span>
      </Button>
    </template>

    <SettingsSection :title="t('email.editor.server.sectionProvider')">
      <div class="flex flex-col gap-2">
        <EmailSegmented
          variant="chips"
          :model-value="preset"
          :options="presetOptions"
          :label="t('email.editor.server.sectionProvider')"
          @update:model-value="applyPreset"
        />
        <p class="text-xs text-muted-foreground">{{ t('email.editor.server.presetHint') }}</p>
      </div>
      <SettingsField :label="t('email.editor.server.name')" input-id="email-server-name" required>
        <input id="email-server-name" v-model="draft.name" type="text" class="settings-control" autocomplete="off" />
      </SettingsField>
    </SettingsSection>

    <SettingsSection :title="t('email.editor.server.sectionServer')">
      <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_120px]">
        <SettingsField :label="t('email.editor.server.host')" input-id="email-server-host" required>
          <input
            id="email-server-host"
            v-model="draft.host"
            type="text"
            dir="ltr"
            class="settings-control font-mono text-[13px]"
            autocomplete="off"
            placeholder="smtp.example.com"
          />
        </SettingsField>
        <SettingsField :label="t('email.editor.server.port')" input-id="email-server-port" required>
          <input
            id="email-server-port"
            v-model.number="draft.port"
            type="number"
            min="1"
            max="65535"
            dir="ltr"
            class="settings-control font-mono text-[13px]"
          />
        </SettingsField>
      </div>
      <div class="flex flex-col gap-1.5">
        <span class="settings-label">{{ t('email.editor.server.security') }}</span>
        <EmailSegmented
          :model-value="draft.security"
          :options="securityOptions"
          :label="t('email.editor.server.security')"
          @update:model-value="setSecurity"
        />
        <p class="text-xs text-muted-foreground">{{ t('email.editor.server.securityHint') }}</p>
      </div>
    </SettingsSection>

    <SettingsSection :title="t('email.editor.server.sectionSignIn')">
      <SettingsToggleField
        :model-value="draft.auth"
        :label="t('email.editor.server.needsPassword')"
        input-id="email-server-auth"
        @update:model-value="setAuth"
      />
      <div v-if="draft.auth" class="grid gap-4 sm:grid-cols-2">
        <SettingsField :label="t('email.editor.server.username')" input-id="email-server-username">
          <input
            id="email-server-username"
            v-model="draft.username"
            type="text"
            dir="ltr"
            class="settings-control font-mono text-[13px]"
            autocomplete="off"
          />
        </SettingsField>
        <SettingsField
          :label="needsAppPassword ? t('email.editor.server.appPassword') : t('email.editor.server.password')"
          input-id="email-server-password"
          :brief="needsAppPassword ? t('email.editor.server.appPasswordHint') : undefined"
        >
          <template #default="{ describedBy }">
            <div class="flex gap-2">
              <input
                id="email-server-password"
                v-model="draft.password"
                v-bind="SECRET_INPUT_ATTRS"
                type="text"
                class="settings-control"
                :class="{ 'input-secret': !passwordVisible }"
                :placeholder="provider?.hasPassword ? t('email.editor.server.passwordKeep') : ''"
                :aria-describedby="describedBy"
              />
              <Button size="sm" variant="outline" class="h-9 shrink-0" @click="togglePasswordVisible">
                {{ passwordVisible ? t('common.hide') : t('common.show') }}
              </Button>
            </div>
          </template>
        </SettingsField>
      </div>
    </SettingsSection>

    <SettingsSection :title="t('email.editor.server.sectionSender')">
      <div class="grid gap-4 sm:grid-cols-2">
        <SettingsField :label="t('email.editor.server.fromName')" input-id="email-server-from-name">
          <input
            id="email-server-from-name"
            v-model="draft.fromName"
            type="text"
            class="settings-control"
            autocomplete="off"
            :placeholder="t('email.providers.fromNamePlaceholder')"
          />
        </SettingsField>
        <SettingsField
          :label="t('email.editor.server.fromAddress')"
          input-id="email-server-from-address"
          :brief="t('email.editor.server.fromAddressHint')"
        >
          <template #default="{ describedBy }">
            <input
              id="email-server-from-address"
              v-model="draft.fromAddress"
              type="email"
              dir="ltr"
              class="settings-control font-mono text-[13px]"
              autocomplete="off"
              placeholder="books@example.com"
              :aria-describedby="describedBy"
            />
          </template>
        </SettingsField>
      </div>
    </SettingsSection>

    <SettingsSection :title="t('email.editor.server.sectionWho')">
      <SettingsToggleField
        :model-value="draft.shared"
        :label="t('email.editor.server.share')"
        :brief="t('email.editor.server.shareHint')"
        input-id="email-server-shared"
        @update:model-value="setShared"
      />
      <SettingsToggleField
        v-if="isSuperuser"
        :model-value="draft.system"
        :label="t('email.editor.server.system')"
        :brief="t('email.editor.server.systemHint')"
        input-id="email-server-system"
        @update:model-value="setSystem"
      />
      <SettingsToggleField
        :model-value="draft.verifyTls"
        :label="t('email.editor.server.verifyTls')"
        :brief="t('email.editor.server.verifyTlsHint')"
        input-id="email-server-verify"
        @update:model-value="setVerifyTls"
      />
      <div
        v-if="!draft.verifyTls"
        class="flex items-start gap-2 rounded-md border border-[var(--pill-warning)]/40 bg-[var(--pill-warning)]/10 px-3 py-2"
      >
        <AlertTriangle :size="14" class="mt-0.5 shrink-0 text-[var(--pill-warning)]" aria-hidden="true" />
        <p class="text-xs text-foreground">{{ t('email.providers.tlsWarning') }}</p>
      </div>
      <p v-if="provider?.isSystemProvider" class="text-xs text-muted-foreground">{{ t('email.editor.server.removeSystemFirst') }}</p>
    </SettingsSection>

    <p v-if="error" role="alert" class="text-xs text-destructive">{{ error }}</p>
  </SettingsEditorSheet>
</template>
