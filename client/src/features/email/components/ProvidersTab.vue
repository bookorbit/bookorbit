<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { toast } from 'vue-sonner'
import { ChevronDown, ChevronUp, Plus, Pencil, Trash2, Star, Share2, Wifi, Server } from 'lucide-vue-next'
import { Permission } from '@projectx/types'
import { useEmailProviders, type EmailProvider, type EmailProviderForm } from '../composables/useEmailProviders'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useAuth } from '@/features/auth/composables/useAuth'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useMediaQuery } from '@vueuse/core'

const {
  providers,
  createProvider,
  updateProvider,
  deleteProvider,
  setDefaultProvider,
  toggleSharedProvider,
  testProvider,
  setSystemProvider,
  clearSystemProvider,
} = useEmailProviders()
const { isSuperuser, hasPermission } = usePermissions()
const { user } = useAuth()
const canManageEmail = computed(() => hasPermission(Permission.ManageEmail))

const showForm = ref(false)
const editingId = ref<number | null>(null)
const saving = ref(false)
const testing = ref<number | null>(null)
const deleteConfirm = ref<EmailProvider | null>(null)
const helpOpen = ref(true)
const isMobile = useMediaQuery('(max-width: 767px)')

const emptyForm = (): EmailProviderForm => ({
  name: '',
  host: '',
  port: 587,
  username: '',
  password: '',
  fromName: '',
  fromAddress: '',
  auth: true,
  ssl: false,
  startTls: true,
})

const form = reactive<EmailProviderForm>(emptyForm())
const formError = ref<string | null>(null)

function openCreate() {
  Object.assign(form, emptyForm())
  editingId.value = null
  formError.value = null
  showForm.value = true
}

function openEdit(p: EmailProvider) {
  Object.assign(form, {
    name: p.name,
    host: p.host,
    port: p.port,
    username: p.username ?? '',
    password: '',
    fromName: p.fromName ?? '',
    fromAddress: p.fromAddress ?? '',
    auth: p.auth,
    ssl: p.ssl,
    startTls: p.startTls,
  })
  editingId.value = p.id
  formError.value = null
  showForm.value = true
}

function cancelForm() {
  showForm.value = false
  editingId.value = null
  formError.value = null
}

async function submitForm() {
  if (!form.name.trim() || !form.host.trim()) {
    formError.value = 'Name and host are required'
    return
  }
  saving.value = true
  formError.value = null
  try {
    if (editingId.value) {
      const payload: Partial<EmailProviderForm> = { ...form }
      if (!payload.password) delete payload.password
      await updateProvider(editingId.value, payload)
      toast.success('Provider updated')
    } else {
      await createProvider(form)
      toast.success('Provider created')
    }
    cancelForm()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'Failed to save'
  } finally {
    saving.value = false
  }
}

async function remove(p: EmailProvider) {
  try {
    await deleteProvider(p.id)
    toast.success(`"${p.name}" deleted`)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to delete')
  }
}

async function setDefault(p: EmailProvider) {
  try {
    await setDefaultProvider(p.id)
    toast.success(`"${p.name}" set as default`)
  } catch {
    toast.error('Failed to set default')
  }
}

async function toggleShare(p: EmailProvider) {
  try {
    await toggleSharedProvider(p.id)
    toast.success(p.isShared ? 'Provider unshared' : 'Provider shared with all users')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to update sharing')
  }
}

async function setSystem(p: EmailProvider) {
  try {
    if (p.isSystemProvider) {
      await clearSystemProvider()
      toast.success(`"${p.name}" removed as system mail provider`)
    } else {
      await setSystemProvider(p.id)
      toast.success(`"${p.name}" set as system mail provider`)
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to update system provider')
  }
}

async function test(p: EmailProvider) {
  testing.value = p.id
  try {
    const result = await testProvider(p.id)
    if (result.success) {
      toast.success('Connection successful')
    } else {
      toast.error(result.error ?? 'Connection failed')
    }
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Test failed')
  } finally {
    testing.value = null
  }
}

function requestRemove(p: EmailProvider) {
  deleteConfirm.value = p
}

async function confirmRemove() {
  if (!deleteConfirm.value) return
  const provider = deleteConfirm.value
  deleteConfirm.value = null
  await remove(provider)
}

watch(
  isMobile,
  (mobile) => {
    helpOpen.value = !mobile
  },
  { immediate: true },
)
</script>

<template>
  <div class="space-y-4">
    <div class="hidden md:flex items-center justify-between">
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">SMTP Providers</p>
      <button
        v-if="canManageEmail && !showForm"
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        @click="openCreate()"
      >
        <Plus :size="12" />
        Add provider
      </button>
    </div>
    <div class="md:hidden flex items-center justify-between">
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">SMTP Providers</p>
    </div>
    <div
      v-if="canManageEmail && !showForm"
      class="md:hidden sticky top-[8.9rem] z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2"
    >
      <button
        class="w-full min-h-10 flex items-center justify-center gap-1.5 px-3 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        @click="openCreate()"
      >
        <Plus :size="13" />
        Add provider
      </button>
    </div>

    <!-- Add/Edit form -->
    <div v-if="canManageEmail && showForm" class="border border-border rounded-lg p-4 md:p-5 bg-card space-y-4">
      <p class="text-sm font-semibold text-foreground">{{ editingId ? 'Edit Provider' : 'New Provider' }}</p>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div class="col-span-2">
          <label class="block text-xs font-medium text-muted-foreground mb-1.5">Name</label>
          <input
            v-model="form.name"
            type="text"
            placeholder="e.g. Gmail"
            class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-muted-foreground mb-1.5">Host</label>
          <input
            v-model="form.host"
            type="text"
            placeholder="smtp.gmail.com"
            class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-muted-foreground mb-1.5">Port</label>
          <input
            v-model.number="form.port"
            type="number"
            class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-muted-foreground mb-1.5">Username</label>
          <input
            v-model="form.username"
            type="text"
            autocomplete="off"
            class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-muted-foreground mb-1.5">
            Password{{ editingId ? ' (leave blank to keep current)' : '' }}
          </label>
          <input
            v-model="form.password"
            type="password"
            autocomplete="new-password"
            class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-muted-foreground mb-1.5">From Name</label>
          <input
            v-model="form.fromName"
            type="text"
            placeholder="My Library"
            class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-muted-foreground mb-1.5">From Address</label>
          <input
            v-model="form.fromAddress"
            type="email"
            placeholder="books@example.com"
            class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>

      <div class="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
        <label class="flex items-center gap-2 cursor-pointer">
          <input v-model="form.auth" type="checkbox" class="rounded border-border" />
          <span class="text-xs text-foreground">Authentication</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <input v-model="form.ssl" type="checkbox" class="rounded border-border" />
          <span class="text-xs text-foreground">SSL</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <input v-model="form.startTls" type="checkbox" class="rounded border-border" />
          <span class="text-xs text-foreground">STARTTLS</span>
        </label>
      </div>

      <div v-if="formError" class="text-xs text-destructive">{{ formError }}</div>

      <div class="hidden md:flex items-center gap-2">
        <button
          class="px-4 py-2 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          :disabled="saving"
          @click="submitForm()"
        >
          {{ saving ? 'Saving...' : editingId ? 'Update' : 'Create' }}
        </button>
        <button
          class="px-4 py-2 text-xs font-medium rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors"
          @click="cancelForm()"
        >
          Cancel
        </button>
      </div>
      <div class="md:hidden sticky bottom-2 z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2">
        <div class="flex items-center gap-2">
          <button class="settings-btn-primary flex-1 min-h-10 justify-center" :disabled="saving" @click="submitForm()">
            {{ saving ? 'Saving...' : editingId ? 'Update' : 'Create' }}
          </button>
          <button
            class="rounded-md border border-border px-3 min-h-10 text-sm text-foreground hover:bg-muted transition-colors"
            @click="cancelForm()"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="providers.length === 0 && !showForm" class="border border-border rounded-lg px-5 py-8 bg-card text-center">
      <p class="text-sm text-muted-foreground">
        {{
          canManageEmail
            ? 'No providers yet. Add an SMTP provider to start sending emails.'
            : 'No providers available. Ask an administrator to add one.'
        }}
      </p>
    </div>

    <!-- List -->
    <div v-else-if="providers.length > 0" class="border border-border rounded-lg overflow-hidden divide-y divide-border">
      <div v-for="p in providers" :key="p.id" class="px-4 py-3 bg-card flex flex-col md:flex-row md:items-center gap-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-medium text-foreground">{{ p.name }}</span>
            <span v-if="p.isDefault" class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary">Default</span>
            <span v-if="p.isShared" class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Shared</span>
            <span v-if="p.isSystemProvider" class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400"
              >System</span
            >
          </div>
          <p class="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {{ p.host }}:{{ p.port }} · {{ p.fromAddress || p.username || 'no from address' }}
          </p>
        </div>

        <div class="flex items-center gap-1 shrink-0 self-end md:self-auto">
          <Tooltip v-if="isSuperuser">
            <TooltipTrigger as-child>
              <button
                class="flex items-center justify-center w-7 h-7 rounded transition-colors"
                :class="p.isSystemProvider ? 'text-amber-500' : 'text-muted-foreground hover:text-amber-500 hover:bg-muted'"
                @click="setSystem(p)"
              >
                <Server :size="13" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{{ p.isSystemProvider ? 'Remove as system mail provider' : 'Set as system mail provider' }}</TooltipContent>
          </Tooltip>
          <Tooltip v-if="canManageEmail">
            <TooltipTrigger as-child>
              <button
                class="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                :disabled="testing === p.id"
                @click="test(p)"
              >
                <Wifi :size="13" :class="testing === p.id ? 'animate-pulse' : ''" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Test connection</TooltipContent>
          </Tooltip>
          <Tooltip v-if="p.userId === user?.id">
            <TooltipTrigger as-child>
              <button
                class="flex items-center justify-center w-7 h-7 rounded transition-colors"
                :class="p.isDefault ? 'text-primary' : 'text-muted-foreground hover:text-primary hover:bg-muted'"
                @click="setDefault(p)"
              >
                <Star :size="13" :class="p.isDefault ? 'fill-primary' : ''" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Set as default</TooltipContent>
          </Tooltip>
          <Tooltip v-if="canManageEmail && (!p.isShared || p.userId !== null)">
            <TooltipTrigger as-child>
              <button
                class="flex items-center justify-center w-7 h-7 rounded transition-colors"
                :class="p.isShared ? 'text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted'"
                @click="toggleShare(p)"
              >
                <Share2 :size="13" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Toggle sharing</TooltipContent>
          </Tooltip>
          <Tooltip v-if="canManageEmail">
            <TooltipTrigger as-child>
              <button
                class="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                @click="openEdit(p)"
              >
                <Pencil :size="13" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>
          <Tooltip v-if="canManageEmail && p.userId !== null">
            <TooltipTrigger as-child>
              <button
                class="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                @click="requestRemove(p)"
              >
                <Trash2 :size="13" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>

    <div class="border border-border rounded-lg bg-card/50">
      <button class="w-full flex items-center justify-between gap-2 p-4 text-left" @click="helpOpen = !helpOpen">
        <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Provider Notes</p>
        <ChevronUp v-if="helpOpen" :size="14" class="text-muted-foreground" />
        <ChevronDown v-else :size="14" class="text-muted-foreground" />
      </button>
      <p v-if="helpOpen" class="px-4 pb-4 text-xs text-muted-foreground">
        The <strong>System</strong> provider (superuser only) is used for password reset emails. The <strong>Default</strong> provider is used when
        sending books with no explicit provider selected. Providers marked <strong>Shared</strong> are available to all users.
      </p>
    </div>

    <div v-if="deleteConfirm" class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4" @click.self="deleteConfirm = null">
      <button class="absolute inset-0 bg-black/45" @click="deleteConfirm = null" />
      <div class="relative w-full rounded-t-xl border border-border bg-card p-4 shadow-xl md:max-w-md md:rounded-xl md:p-5">
        <p class="text-base font-semibold text-foreground">Delete provider?</p>
        <p class="mt-1 text-sm text-muted-foreground">Delete "{{ deleteConfirm.name }}". This action cannot be undone.</p>
        <div class="mt-4 flex items-center justify-end gap-2">
          <button
            class="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
            @click="deleteConfirm = null"
          >
            Cancel
          </button>
          <button
            class="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
            @click="confirmRemove"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
