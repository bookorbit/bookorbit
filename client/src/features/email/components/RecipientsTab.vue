<script setup lang="ts">
import { ref, reactive } from 'vue'
import { toast } from 'vue-sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Plus, Pencil, Trash2, Star } from 'lucide-vue-next'
import { useEmailRecipients, type EmailRecipient, type EmailRecipientForm } from '../composables/useEmailRecipients'
import { useEmailTemplates } from '../composables/useEmailTemplates'

const { recipients, createRecipient, updateRecipient, deleteRecipient, setDefaultRecipient } = useEmailRecipients()
const { templates, fetchTemplates } = useEmailTemplates()

const DEVICE_TYPES = [
  { value: 'kindle', label: 'Kindle' },
  { value: 'kobo', label: 'Kobo' },
  { value: 'other', label: 'Other' },
]

const FORMATS = ['epub', 'pdf', 'mobi', 'azw3', 'cbz', 'cbr']

const showForm = ref(false)
const editingId = ref<number | null>(null)
const saving = ref(false)

const emptyForm = (): EmailRecipientForm => ({
  name: '',
  email: '',
  deviceType: null,
  preferredFormat: null,
  defaultTemplateId: null,
})

const form = reactive<EmailRecipientForm>(emptyForm())
const formError = ref<string | null>(null)

function openCreate() {
  Object.assign(form, emptyForm())
  editingId.value = null
  formError.value = null
  showForm.value = true
  fetchTemplates().catch(() => {})
}

function openEdit(r: EmailRecipient) {
  Object.assign(form, {
    name: r.name,
    email: r.email,
    deviceType: r.deviceType,
    preferredFormat: r.preferredFormat,
    defaultTemplateId: r.defaultTemplateId,
  })
  editingId.value = r.id
  formError.value = null
  showForm.value = true
  fetchTemplates().catch(() => {})
}

function cancelForm() {
  showForm.value = false
  editingId.value = null
  formError.value = null
}

async function submitForm() {
  if (!form.name.trim() || !form.email.trim()) {
    formError.value = 'Name and email are required'
    return
  }
  saving.value = true
  formError.value = null
  try {
    if (editingId.value) {
      await updateRecipient(editingId.value, form)
      toast.success('Recipient updated')
    } else {
      await createRecipient(form)
      toast.success('Recipient created')
    }
    cancelForm()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'Failed to save'
  } finally {
    saving.value = false
  }
}

async function remove(r: EmailRecipient) {
  if (!confirm(`Delete recipient "${r.name}"?`)) return
  try {
    await deleteRecipient(r.id)
    toast.success(`"${r.name}" deleted`)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to delete')
  }
}

async function setDefault(r: EmailRecipient) {
  try {
    await setDefaultRecipient(r.id)
    toast.success(`"${r.name}" set as default`)
  } catch {
    toast.error('Failed to set default')
  }
}

function deviceLabel(type: string | null): string {
  return DEVICE_TYPES.find((d) => d.value === type)?.label ?? type ?? ''
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recipients</p>
      <button
        v-if="!showForm"
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        @click="openCreate()"
      >
        <Plus :size="12" />
        Add recipient
      </button>
    </div>

    <!-- Form -->
    <div v-if="showForm" class="border border-border rounded-lg p-5 bg-card space-y-4">
      <p class="text-sm font-semibold text-foreground">{{ editingId ? 'Edit Recipient' : 'New Recipient' }}</p>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-xs font-medium text-muted-foreground mb-1.5">Name</label>
          <input
            v-model="form.name"
            type="text"
            placeholder="My Kindle"
            class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-muted-foreground mb-1.5">Email address</label>
          <input
            v-model="form.email"
            type="email"
            placeholder="name@kindle.com"
            class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label class="block text-xs font-medium text-muted-foreground mb-1.5">Device type</label>
          <select
            v-model="form.deviceType"
            class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option :value="null">None</option>
            <option v-for="d in DEVICE_TYPES" :key="d.value" :value="d.value">{{ d.label }}</option>
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-muted-foreground mb-1.5">Preferred format</label>
          <select
            v-model="form.preferredFormat"
            class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option :value="null">Auto</option>
            <option v-for="f in FORMATS" :key="f" :value="f">{{ f.toUpperCase() }}</option>
          </select>
        </div>
        <div class="col-span-2">
          <label class="block text-xs font-medium text-muted-foreground mb-1.5">Default template</label>
          <select
            v-model="form.defaultTemplateId"
            class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option :value="null">Use account default</option>
            <option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</option>
          </select>
        </div>
      </div>

      <div v-if="form.deviceType === 'kindle'" class="text-xs text-muted-foreground bg-muted/50 rounded px-3 py-2">
        Kindle recipients automatically receive emails with subject "convert" to trigger format conversion.
      </div>

      <div v-if="formError" class="text-xs text-destructive">{{ formError }}</div>

      <div class="flex items-center gap-2">
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
    </div>

    <!-- Empty state -->
    <div v-if="recipients.length === 0 && !showForm" class="border border-border rounded-lg px-5 py-8 bg-card text-center">
      <p class="text-sm text-muted-foreground">No recipients yet.</p>
    </div>

    <!-- List -->
    <div v-else-if="recipients.length > 0" class="border border-border rounded-lg overflow-hidden divide-y divide-border">
      <div v-for="r in recipients" :key="r.id" class="px-4 py-3 bg-card flex items-center gap-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm font-medium text-foreground">{{ r.name }}</span>
            <span v-if="r.isDefault" class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary">Default</span>
            <span v-if="r.deviceType" class="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {{ deviceLabel(r.deviceType) }}
            </span>
          </div>
          <p class="text-xs text-muted-foreground mt-0.5">
            {{ r.email }}
            <span v-if="r.preferredFormat"> · prefers {{ r.preferredFormat.toUpperCase() }}</span>
          </p>
        </div>

        <div class="flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="flex items-center justify-center w-7 h-7 rounded transition-colors"
                :class="r.isDefault ? 'text-primary' : 'text-muted-foreground hover:text-primary hover:bg-muted'"
                @click="setDefault(r)"
              >
                <Star :size="13" :class="r.isDefault ? 'fill-primary' : ''" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Set as default</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                @click="openEdit(r)"
              >
                <Pencil :size="13" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Edit</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                @click="remove(r)"
              >
                <Trash2 :size="13" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  </div>
</template>
