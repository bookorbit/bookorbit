<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  AlertTriangle,
  BookOpen,
  Calendar,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Eye,
  EyeOff,
  Library,
  RefreshCw,
  Smartphone,
  Trash2,
  User,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import SettingsPageHeader from './SettingsPageHeader.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { copyToClipboard } from '@/lib/clipboard'
import { useKoreaderSync } from '@/features/koreader/composables/useKoreaderSync'

const { t } = useI18n()
const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const {
  credentials,
  syncStatus,
  loading,
  fetchSyncStatus,
  createCredentials,
  updateCredentials,
  deleteCredentials,
  getSyncUrl,
  downloadPluginPackage,
} = useKoreaderSync()

const error = ref<string | null>(null)
const showSetupForm = ref(false)
const newUsername = ref('')
const newPassword = ref('')
const creating = ref(false)
const showPassword = ref(false)
const deleteConfirmOpen = ref(false)
const helpOpen = ref(false)
const urlCopied = ref(false)

let urlCopiedTimer: ReturnType<typeof setTimeout> | null = null

onUnmounted(() => {
  if (urlCopiedTimer) clearTimeout(urlCopiedTimer)
})

const syncUrl = computed(() => getSyncUrl())
const hasCredentials = computed(() => !!credentials.value)
const deviceCount = computed(() => syncStatus.value?.devices.length ?? 0)
const totalSyncedBooks = computed(() => syncStatus.value?.totalSyncedBooks ?? 0)
const sweeps = computed(() => syncStatus.value?.sweeps ?? [])
const pluginTotals = computed(
  () =>
    syncStatus.value?.pluginTotals ?? {
      matchedBooks: 0,
      pageStatEvents: 0,
      annotations: 0,
      trashedAnnotations: 0,
      pendingDeletes: 0,
      failedPositions: 0,
    },
)
const latestPluginVersion = computed(() => syncStatus.value?.latestPluginVersion ?? null)
const pluginUpdateAvailable = computed(() => syncStatus.value?.pluginUpdateAvailable ?? false)
const latestPluginLabel = computed(() =>
  latestPluginVersion.value
    ? t('settings.reader.koreader.latestPlugin', { version: latestPluginVersion.value })
    : t('settings.reader.koreader.latestPluginUnavailable'),
)
const pendingDeletes = computed(() => pluginTotals.value.pendingDeletes)
const failedPositions = computed(() => pluginTotals.value.failedPositions)
const hasPluginActivity = computed(
  () =>
    sweeps.value.length > 0 ||
    pluginTotals.value.matchedBooks > 0 ||
    pluginTotals.value.pageStatEvents > 0 ||
    pluginTotals.value.annotations > 0 ||
    pluginTotals.value.trashedAnnotations > 0 ||
    pendingDeletes.value > 0 ||
    failedPositions.value > 0,
)
const createDisabled = computed(() => creating.value || !newUsername.value || newPassword.value.length < 6)

function formatLastSync(dateStr: string | null): string {
  if (!dateStr) return t('settings.reader.koreader.never')
  const d = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return t('settings.reader.koreader.justNow')
  if (diffMins < 60) return t('settings.reader.koreader.minutesAgo', { count: diffMins })
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return t('settings.reader.koreader.hoursAgo', { count: diffHours })
  const diffDays = Math.floor(diffHours / 24)
  return t('settings.reader.koreader.daysAgo', { count: diffDays })
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return t('settings.reader.koreader.unknown')
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(dateStr))
}

function pluginUpdateText(updateAvailable: boolean | null): string {
  if (updateAvailable === true) return t('settings.reader.koreader.updateAvailable')
  if (updateAvailable === false) return t('settings.reader.koreader.upToDate')
  return t('settings.reader.koreader.versionUnknown')
}

function pluginUpdateClass(updateAvailable: boolean | null): string {
  if (updateAvailable === true) return 'border-primary/40 bg-primary/10 text-primary'
  if (updateAvailable === false) return 'border-border bg-muted text-muted-foreground'
  return 'border-border bg-background text-muted-foreground'
}

onMounted(async () => {
  try {
    await fetchSyncStatus()
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('settings.reader.koreader.loadFailed')
  }
})

async function handleCreate() {
  creating.value = true
  try {
    await createCredentials({ username: newUsername.value, password: newPassword.value })
    showSetupForm.value = false
    helpOpen.value = false
    newUsername.value = ''
    newPassword.value = ''
    toast.success(t('settings.reader.koreader.credentialsCreated'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('settings.reader.koreader.createCredentialsFailed'))
  } finally {
    creating.value = false
  }
}

function handleShowSetupForm() {
  showSetupForm.value = true
}

function handleCancelSetup() {
  showSetupForm.value = false
}

function handleTogglePassword() {
  showPassword.value = !showPassword.value
}

function handleOpenDeleteConfirm() {
  deleteConfirmOpen.value = true
}

function handleCloseDeleteConfirm() {
  deleteConfirmOpen.value = false
}

function handleToggleHelp() {
  helpOpen.value = !helpOpen.value
}

async function handleToggleSync(newValue: boolean) {
  try {
    await updateCredentials({ syncEnabled: newValue })
    toast.success(newValue ? t('settings.reader.koreader.syncEnabled') : t('settings.reader.koreader.syncDisabled'))
  } catch {
    toast.error(t('settings.reader.koreader.toggleSyncFailed'))
  }
}

async function handleDelete() {
  try {
    await deleteCredentials()
    deleteConfirmOpen.value = false
    toast.success(t('settings.reader.koreader.credentialsDeleted'))
  } catch {
    toast.error(t('settings.reader.koreader.deleteCredentialsFailed'))
  }
}

async function handleCopyUrl() {
  const copied = await copyToClipboard(syncUrl.value)
  if (!copied) {
    toast.error(t('settings.reader.koreader.syncUrlCopyFailed'))
    return
  }

  urlCopied.value = true
  toast.success(t('settings.reader.koreader.syncUrlCopied'))
  if (urlCopiedTimer) clearTimeout(urlCopiedTimer)
  urlCopiedTimer = setTimeout(() => {
    urlCopied.value = false
    urlCopiedTimer = null
  }, 2000)
}

async function handleRefresh() {
  try {
    await fetchSyncStatus()
    toast.success(t('settings.reader.koreader.statusRefreshed'))
  } catch {
    toast.error(t('settings.reader.koreader.refreshFailed'))
  }
}

const downloadingPlugin = ref(false)

async function handleDownloadPlugin() {
  downloadingPlugin.value = true
  try {
    await downloadPluginPackage()
    toast.success(t('settings.reader.koreader.pluginDownloaded'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('settings.reader.koreader.pluginDownloadFailed'))
  } finally {
    downloadingPlugin.value = false
  }
}
</script>

<template>
  <SettingsPageHeader
    v-if="!props.embedded"
    class="hidden md:flex"
    :title="t('settings.reader.koreader.title')"
    :subtitle="t('settings.reader.koreader.subtitle')"
  />
  <div v-if="!props.embedded" class="md:hidden px-1">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">{{ t('settings.reader.koreader.title') }}</h1>
    <p
      class="mt-1 text-sm text-muted-foreground leading-5 overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
    >
      {{ t('settings.reader.koreader.subtitle') }}
    </p>
  </div>

  <div v-if="loading" class="mt-5 md:mt-0 border border-border rounded-lg px-5 py-8 bg-card text-sm text-muted-foreground shadow-xs">
    {{ t('settings.reader.koreader.loadingSettings') }}
  </div>
  <div v-else-if="error" class="border border-destructive/30 rounded-lg px-5 py-4 bg-card text-sm text-destructive shadow-xs">{{ error }}</div>
  <template v-else>
    <template v-if="!hasCredentials">
      <div v-if="!showSetupForm" class="border border-border rounded-lg px-5 py-8 bg-card text-center shadow-xs">
        <div class="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
          <BookOpen :size="18" class="text-muted-foreground/80" />
        </div>
        <p class="text-sm font-medium text-foreground">{{ t('settings.reader.koreader.notConfigured') }}</p>
        <p class="text-xs text-muted-foreground mt-1 mb-4 max-w-sm mx-auto">
          {{ t('settings.reader.koreader.notConfiguredHint') }}
        </p>
        <button class="settings-btn-primary mx-auto min-h-10 justify-center" @click="handleShowSetupForm">
          <User :size="13" />
          {{ t('settings.reader.koreader.createCredentials') }}
        </button>
      </div>

      <div v-else class="border border-border rounded-lg p-4 md:p-5 bg-card space-y-4 shadow-xs">
        <p class="text-sm font-medium text-foreground">{{ t('settings.reader.koreader.createFormTitle') }}</p>
        <p class="text-xs text-muted-foreground">{{ t('settings.reader.koreader.createFormHint') }}</p>
        <div>
          <label class="block text-xs font-medium text-muted-foreground mb-1.5">{{ t('settings.reader.koreader.username') }}</label>
          <input
            v-model="newUsername"
            type="text"
            :placeholder="t('settings.reader.koreader.usernamePlaceholder')"
            class="input-field w-full"
            autocomplete="off"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-muted-foreground mb-1.5">{{ t('settings.reader.koreader.password') }}</label>
          <div class="relative">
            <input
              v-model="newPassword"
              :type="showPassword ? 'text' : 'password'"
              :placeholder="t('settings.reader.koreader.passwordPlaceholder')"
              class="input-field w-full pr-10"
              autocomplete="new-password"
            />
            <button class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" @click="handleTogglePassword">
              <EyeOff v-if="showPassword" :size="14" />
              <Eye v-else :size="14" />
            </button>
          </div>
        </div>
        <div class="hidden md:flex items-center gap-2 pt-1">
          <button class="settings-btn-primary" :disabled="createDisabled" @click="handleCreate">
            {{ creating ? t('settings.reader.koreader.creating') : t('settings.reader.koreader.create') }}
          </button>
          <button class="settings-btn-outline" @click="handleCancelSetup">{{ t('common.cancel') }}</button>
        </div>
        <div class="md:hidden sticky bottom-2 z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2">
          <div class="flex items-center gap-2">
            <button class="settings-btn-primary flex-1 min-h-10 justify-center" :disabled="createDisabled" @click="handleCreate">
              {{ creating ? t('settings.reader.koreader.creating') : t('settings.reader.koreader.create') }}
            </button>
            <button
              class="rounded-md border border-border px-3 min-h-10 text-sm text-foreground hover:bg-muted transition-colors"
              @click="handleCancelSetup"
            >
              {{ t('common.cancel') }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <div class="mb-8">
        <div class="flex items-center justify-between mb-3">
          <p class="settings-group-label mb-0">{{ t('settings.reader.koreader.status') }}</p>
          <button class="settings-btn-outline" @click="handleRefresh">
            <RefreshCw :size="12" />
            {{ t('settings.reader.koreader.refresh') }}
          </button>
        </div>
        <div class="border border-border rounded-lg overflow-hidden shadow-xs divide-y divide-border">
          <div class="flex flex-col gap-3 px-4 py-3.5 bg-card md:flex-row md:items-center md:justify-between md:px-5 md:py-4">
            <div class="min-w-0">
              <p class="settings-label">{{ t('settings.reader.koreader.progressSync') }}</p>
              <p class="settings-hint">
                {{ t('settings.reader.koreader.progressSyncHint') }}
              </p>
            </div>
            <ToggleSwitch :model-value="credentials?.syncEnabled ?? false" class="self-start md:self-auto" @update:model-value="handleToggleSync" />
          </div>
          <div class="grid gap-3 px-4 py-4 bg-card md:grid-cols-2 lg:grid-cols-5 md:px-5">
            <div class="min-w-0">
              <p class="settings-label">{{ t('settings.reader.koreader.username') }}</p>
              <p class="settings-hint font-mono truncate">{{ credentials?.username }}</p>
            </div>
            <div>
              <p class="settings-label">{{ t('settings.reader.koreader.lastSync') }}</p>
              <p class="settings-hint">{{ formatLastSync(syncStatus?.lastSyncAt ?? null) }}</p>
            </div>
            <div>
              <p class="settings-label">{{ t('settings.reader.koreader.syncedBooks') }}</p>
              <p class="settings-hint">{{ t('settings.reader.koreader.bookCount', { count: totalSyncedBooks }, totalSyncedBooks) }}</p>
            </div>
            <div>
              <p class="settings-label">{{ t('settings.reader.koreader.devices') }}</p>
              <p class="settings-hint">{{ t('settings.reader.koreader.deviceCount', { count: deviceCount }, deviceCount) }}</p>
            </div>
            <div>
              <p class="settings-label">{{ t('settings.reader.koreader.credentialsCreatedLabel') }}</p>
              <p class="settings-hint">{{ formatDate(credentials?.createdAt) }}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="mb-8">
        <p class="settings-group-label">{{ t('settings.reader.koreader.setup') }}</p>
        <div class="border border-border rounded-lg overflow-hidden shadow-xs divide-y divide-border">
          <div class="px-4 py-4 bg-card md:px-5">
            <div class="mb-2 flex items-center gap-2">
              <BookOpen :size="14" class="text-muted-foreground shrink-0" />
              <p class="settings-label">{{ t('settings.reader.koreader.pluginServerUrl') }}</p>
            </div>
            <div class="flex flex-col gap-2 md:flex-row md:items-center">
              <input :value="syncUrl" readonly class="input-field flex-1 min-w-0 font-mono text-xs md:text-sm" />
              <button class="settings-btn-outline w-full min-h-10 justify-center md:w-auto md:min-h-0" @click="handleCopyUrl">
                <Check v-if="urlCopied" :size="12" />
                <Copy v-else :size="12" />
                {{ urlCopied ? t('settings.reader.koreader.copied') : t('settings.reader.koreader.copyUrl') }}
              </button>
            </div>
          </div>
          <div class="flex flex-col gap-3 px-4 py-4 bg-card md:flex-row md:items-center md:justify-between md:px-5">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <p class="settings-label">{{ t('settings.reader.koreader.preconfiguredPlugin') }}</p>
                <span
                  v-if="pluginUpdateAvailable"
                  class="rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                >
                  {{ t('settings.reader.koreader.updateAvailable') }}
                </span>
              </div>
              <p class="settings-hint">
                {{ t('settings.reader.koreader.preconfiguredPluginHintPrefix') }}
                <span class="font-mono text-foreground/70">koreader/plugins/</span>
                {{ t('settings.reader.koreader.preconfiguredPluginHintSuffix') }}
              </p>
              <p class="settings-hint mt-1">{{ t('settings.reader.koreader.latestPluginNote', { label: latestPluginLabel }) }}</p>
            </div>
            <button class="settings-btn-primary self-start md:self-auto" :disabled="downloadingPlugin" @click="handleDownloadPlugin">
              <Download :size="12" />
              {{ downloadingPlugin ? t('settings.reader.koreader.preparing') : t('settings.reader.koreader.downloadPlugin') }}
            </button>
          </div>
        </div>
      </div>

      <div class="mb-8">
        <p class="settings-group-label">{{ t('settings.reader.koreader.devices') }}</p>
        <div v-if="deviceCount === 0" class="border border-border rounded-lg px-5 py-8 bg-card text-center shadow-xs">
          <div class="w-10 h-10 rounded-lg bg-muted flex items-center justify-center mx-auto mb-3">
            <Smartphone :size="18" class="text-muted-foreground/80" />
          </div>
          <p class="text-sm font-medium text-foreground">{{ t('settings.reader.koreader.noDevicesSynced') }}</p>
          <p class="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            {{ t('settings.reader.koreader.noDevicesSyncedHint') }}
          </p>
        </div>
        <div v-else class="border border-border rounded-lg overflow-hidden shadow-xs divide-y divide-border">
          <div v-for="device in syncStatus?.devices ?? []" :key="device.deviceId" class="px-4 py-4 bg-card md:px-5">
            <div class="flex items-start gap-3">
              <div class="w-9 h-9 rounded-lg bg-muted flex items-center justify-center text-muted-foreground shrink-0 border border-border">
                <Smartphone :size="16" />
              </div>
              <div class="flex-1 min-w-0">
                <p class="settings-label truncate">{{ device.device }}</p>
                <div class="mt-1 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
                  <p class="min-w-0">
                    {{ t('settings.reader.koreader.lastSyncLabel') }} <span class="text-foreground/80">{{ formatLastSync(device.lastSyncAt) }}</span>
                  </p>
                  <p class="min-w-0 truncate">
                    {{ t('settings.reader.koreader.lastBookLabel') }}
                    <span class="text-foreground/80">{{ device.lastBookTitle ?? t('settings.reader.koreader.noneYet') }}</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="mb-8">
        <p class="settings-group-label">{{ t('settings.reader.koreader.pluginActivity') }}</p>
        <div class="border border-border rounded-lg overflow-hidden shadow-xs divide-y divide-border">
          <div v-if="!hasPluginActivity" class="px-4 py-5 bg-card text-sm text-muted-foreground md:px-5">
            {{ t('settings.reader.koreader.noPluginActivity') }}
          </div>
          <div v-for="sweep in sweeps" :key="sweep.deviceId" class="px-4 py-4 bg-card md:px-5">
            <div class="flex items-start gap-3">
              <div class="w-9 h-9 rounded-lg bg-muted flex items-center justify-center text-muted-foreground shrink-0 border border-border">
                <Smartphone :size="16" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <p class="settings-label truncate">
                    {{ sweep.deviceModel }}
                    <span v-if="sweep.pluginVersion" class="font-normal text-muted-foreground"> v{{ sweep.pluginVersion }}</span>
                  </p>
                  <span class="rounded-md border px-2 py-0.5 text-[11px] font-medium" :class="pluginUpdateClass(sweep.updateAvailable)">
                    {{ pluginUpdateText(sweep.updateAvailable) }}
                  </span>
                </div>
                <p class="settings-hint mt-1">
                  {{ t('settings.reader.koreader.lastFullSync', { time: formatLastSync(sweep.lastSweepAt) }) }}
                  <span v-if="sweep.updateAvailable === true && sweep.latestPluginVersion">
                    {{ t('settings.reader.koreader.latestPluginSuffix', { version: sweep.latestPluginVersion }) }}</span
                  >
                </p>
              </div>
            </div>
            <div class="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
              <div class="rounded-md border border-border bg-background px-3 py-2">
                <p class="font-medium text-foreground">{{ sweep.lastSweepBooksMatched }}</p>
                <p>{{ t('settings.reader.koreader.matchedBooks') }}</p>
              </div>
              <div class="rounded-md border border-border bg-background px-3 py-2">
                <p class="font-medium text-foreground">{{ sweep.lastSweepPageStats }}</p>
                <p>{{ t('settings.reader.koreader.readingEvents') }}</p>
              </div>
              <div class="rounded-md border border-border bg-background px-3 py-2">
                <p class="font-medium text-foreground">{{ sweep.lastSweepAnnotations }}</p>
                <p>{{ t('settings.reader.koreader.highlights') }}</p>
              </div>
            </div>
          </div>
          <div v-if="hasPluginActivity" class="px-4 py-4 bg-card md:px-5">
            <div class="flex items-center gap-2 mb-3">
              <Library :size="14" class="text-muted-foreground shrink-0" />
              <p class="settings-label">{{ t('settings.reader.koreader.syncedTotals') }}</p>
            </div>
            <div class="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-4">
              <div class="rounded-md border border-border bg-background px-3 py-2">
                <p class="font-medium text-foreground">{{ pluginTotals.matchedBooks }}</p>
                <p>{{ t('settings.reader.koreader.matchedBooks') }}</p>
              </div>
              <div class="rounded-md border border-border bg-background px-3 py-2">
                <p class="font-medium text-foreground">{{ pluginTotals.pageStatEvents }}</p>
                <p>{{ t('settings.reader.koreader.readingEvents') }}</p>
              </div>
              <div class="rounded-md border border-border bg-background px-3 py-2">
                <p class="font-medium text-foreground">{{ pluginTotals.annotations }}</p>
                <p>{{ t('settings.reader.koreader.highlights') }}</p>
              </div>
              <div class="rounded-md border border-border bg-background px-3 py-2">
                <p class="font-medium text-foreground">{{ pluginTotals.trashedAnnotations }}</p>
                <p>{{ t('settings.reader.koreader.trashedHighlights') }}</p>
              </div>
            </div>
            <div v-if="pendingDeletes > 0" class="mt-3 flex gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
              <AlertTriangle :size="14" class="mt-0.5 shrink-0 text-muted-foreground" />
              <p>{{ t('settings.reader.koreader.pendingDeletes', { count: pendingDeletes }, pendingDeletes) }}</p>
            </div>
            <div v-if="failedPositions > 0" class="mt-3 flex gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground">
              <AlertTriangle :size="14" class="mt-0.5 shrink-0 text-muted-foreground" />
              <p>{{ t('settings.reader.koreader.failedPositions', { count: failedPositions }, failedPositions) }}</p>
            </div>
          </div>
        </div>
      </div>

      <div class="mb-8">
        <p class="settings-group-label">{{ t('settings.reader.koreader.setupGuide') }}</p>
        <div class="border border-border rounded-lg bg-card shadow-xs">
          <button class="w-full flex items-center justify-between gap-2 px-4 py-4 text-left md:px-5" @click="handleToggleHelp">
            <div class="flex-1 min-w-0">
              <p class="settings-label">{{ t('settings.reader.koreader.setupSteps') }}</p>
              <p class="settings-hint">
                {{ t('settings.reader.koreader.setupStepsHint') }}
              </p>
            </div>
            <ChevronUp v-if="helpOpen" :size="14" class="text-muted-foreground shrink-0" />
            <ChevronDown v-else :size="14" class="text-muted-foreground shrink-0" />
          </button>
          <div v-if="helpOpen" class="border-t border-border px-4 py-4 space-y-4 text-xs text-muted-foreground md:px-5">
            <div>
              <p class="font-medium text-foreground/80 mb-2">{{ t('settings.reader.koreader.pluginGuideTitle') }}</p>
              <ol class="list-decimal list-inside space-y-2 pl-1">
                <li>{{ t('settings.reader.koreader.pluginStep1') }}</li>
                <li>
                  {{ t('settings.reader.koreader.pluginStep2Prefix') }}
                  <span class="font-mono text-foreground/70">bookorbit.koplugin</span>
                  {{ t('settings.reader.koreader.pluginStep2Middle') }}
                  <span class="font-mono text-foreground/70">koreader/plugins/</span>
                  {{ t('settings.reader.koreader.pluginStep2Suffix') }}
                </li>
                <li>{{ t('settings.reader.koreader.pluginStep3') }}</li>
                <li>
                  {{ t('settings.reader.koreader.pluginStep4Prefix') }}
                  <span class="font-mono text-foreground/70">Browse BookOrbit</span>
                  {{ t('settings.reader.koreader.pluginStep4Suffix') }}
                </li>
              </ol>
            </div>
            <div>
              <p class="font-medium text-foreground/80 mb-2">{{ t('settings.reader.koreader.stockGuideTitle') }}</p>
              <ol class="list-decimal list-inside space-y-2 pl-1">
                <li>
                  {{ t('settings.reader.koreader.stockStep1Prefix') }}
                  <span class="font-mono text-foreground/70">Tools &gt; Progress sync</span>{{ t('settings.reader.koreader.stockStep1Suffix') }}
                </li>
                <li>{{ t('settings.reader.koreader.stockStep2') }}</li>
                <li>{{ t('settings.reader.koreader.stockStep3') }}</li>
              </ol>
            </div>
            <div class="flex gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
              <Calendar :size="14" class="mt-0.5 shrink-0 text-muted-foreground" />
              <p>
                {{ t('settings.reader.koreader.locationNote') }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div class="mb-6">
        <p class="settings-group-label">{{ t('settings.reader.koreader.dangerZone') }}</p>
        <div class="border border-destructive/30 rounded-lg overflow-hidden shadow-xs">
          <div class="flex flex-col gap-3 px-4 py-4 bg-card md:flex-row md:items-center md:justify-between md:px-5">
            <div class="min-w-0">
              <p class="settings-label">{{ t('settings.reader.koreader.deleteCredentials') }}</p>
              <p class="settings-hint">{{ t('settings.reader.koreader.deleteCredentialsHint') }}</p>
            </div>
            <button
              class="self-start md:self-auto flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors shrink-0"
              @click="handleOpenDeleteConfirm"
            >
              <Trash2 :size="12" />
              {{ t('common.delete') }}
            </button>
          </div>
        </div>
      </div>
    </template>

    <div
      v-if="deleteConfirmOpen"
      class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4"
      @click.self="handleCloseDeleteConfirm"
    >
      <button class="absolute inset-0 bg-black/45" @click="handleCloseDeleteConfirm" />
      <div class="relative w-full rounded-t-lg border border-border bg-card p-4 shadow-xl md:max-w-md md:rounded-lg md:p-5">
        <p class="text-base font-semibold text-foreground">{{ t('settings.reader.koreader.deleteConfirmTitle') }}</p>
        <p class="mt-1 text-sm text-muted-foreground">
          {{ t('settings.reader.koreader.deleteConfirmBody') }}
        </p>
        <div class="mt-4 flex items-center justify-end gap-2">
          <button
            class="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
            @click="handleCloseDeleteConfirm"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
            @click="handleDelete"
          >
            {{ t('common.delete') }}
          </button>
        </div>
      </div>
    </div>
  </template>
</template>
