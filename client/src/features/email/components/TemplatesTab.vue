<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Plus, Pencil, Trash2, Star, ChevronDown, ChevronRight, ChevronUp } from 'lucide-vue-next'
import { useEmailTemplates, type EmailTemplate, type EmailTemplateForm } from '../composables/useEmailTemplates'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useMediaQuery } from '@vueuse/core'

const { templates, createTemplate, updateTemplate, deleteTemplate, setDefaultTemplate } = useEmailTemplates()
const { isSuperuser } = usePermissions()

const expandedId = ref<number | null>(null)

const showForm = ref(false)
const editingId = ref<number | null>(null)
const saving = ref(false)
const deleteConfirm = ref<EmailTemplate | null>(null)
const variablesOpen = ref(true)
const notesOpen = ref(true)
const isMobile = useMediaQuery('(max-width: 767px)')

const emptyForm = (): EmailTemplateForm => ({
  name: '',
  subject: 'New Book: {{title}}',
  bodyText: 'Hi {{senderName}},\n\nI\'ve sent you "{{title}}" by {{authors}}.\n\nEnjoy reading!',
})

const form = reactive<EmailTemplateForm>(emptyForm())
const formError = ref<string | null>(null)

const VARIABLES = ['{{title}}', '{{authors}}', '{{senderName}}', '{{seriesName}}', '{{seriesIndex}}', '{{publishedYear}}', '{{isbn}}']

function openCreate() {
  Object.assign(form, emptyForm())
  editingId.value = null
  formError.value = null
  showForm.value = true
}

function openEdit(t: EmailTemplate) {
  Object.assign(form, { name: t.name, subject: t.subject, bodyText: t.bodyText })
  editingId.value = t.id
  formError.value = null
  showForm.value = true
}

function cancelForm() {
  showForm.value = false
  editingId.value = null
  formError.value = null
}

async function submitForm() {
  if (!form.name.trim() || !form.subject.trim()) {
    formError.value = 'Name and subject are required'
    return
  }
  saving.value = true
  formError.value = null
  try {
    if (editingId.value) {
      await updateTemplate(editingId.value, form)
      toast.success('Template updated')
    } else {
      await createTemplate(form)
      toast.success('Template created')
    }
    cancelForm()
  } catch (e) {
    formError.value = e instanceof Error ? e.message : 'Failed to save'
  } finally {
    saving.value = false
  }
}

async function remove(t: EmailTemplate) {
  try {
    await deleteTemplate(t.id)
    toast.success(`"${t.name}" deleted`)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to delete')
  }
}

function requestRemove(t: EmailTemplate) {
  deleteConfirm.value = t
}

async function confirmRemove() {
  if (!deleteConfirm.value) return
  const template = deleteConfirm.value
  deleteConfirm.value = null
  await remove(template)
}

async function setDefault(t: EmailTemplate) {
  try {
    await setDefaultTemplate(t.id)
    toast.success(`"${t.name}" set as default`)
  } catch {
    toast.error('Failed to set default')
  }
}

function insertVariable(variable: string, field: 'subject' | 'bodyText') {
  form[field] = form[field] + variable
}

watch(
  isMobile,
  (mobile) => {
    variablesOpen.value = !mobile
    notesOpen.value = !mobile
  },
  { immediate: true },
)
</script>

<template>
  <div class="space-y-4">
    <div class="hidden md:flex items-center justify-between">
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email Templates</p>
      <button
        v-if="!showForm"
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        @click="openCreate()"
      >
        <Plus :size="12" />
        New template
      </button>
    </div>
    <div class="md:hidden flex items-center justify-between">
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email Templates</p>
    </div>
    <div v-if="!showForm" class="md:hidden sticky top-[8.9rem] z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2">
      <button
        class="w-full min-h-10 flex items-center justify-center gap-1.5 px-3 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        @click="openCreate()"
      >
        <Plus :size="13" />
        New template
      </button>
    </div>

    <!-- Form -->
    <div v-if="showForm" class="border border-border rounded-lg p-4 md:p-5 bg-card space-y-4">
      <p class="text-sm font-semibold text-foreground">{{ editingId ? 'Edit Template' : 'New Template' }}</p>

      <div>
        <label class="block text-xs font-medium text-muted-foreground mb-1.5">Name</label>
        <input
          v-model="form.name"
          type="text"
          placeholder="Default"
          class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div>
        <label class="block text-xs font-medium text-muted-foreground mb-1.5">Subject</label>
        <input
          v-model="form.subject"
          type="text"
          class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      <div>
        <label class="block text-xs font-medium text-muted-foreground mb-1.5">Body</label>
        <textarea
          v-model="form.bodyText"
          rows="6"
          class="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-y font-mono"
        />
      </div>

      <div class="border border-border rounded-lg bg-card/60">
        <button class="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left" @click="variablesOpen = !variablesOpen">
          <p class="text-xs font-medium text-muted-foreground">Available variables</p>
          <ChevronUp v-if="variablesOpen" :size="14" class="text-muted-foreground" />
          <ChevronDown v-else :size="14" class="text-muted-foreground" />
        </button>
        <div v-if="variablesOpen" class="px-3 pb-3">
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="v in VARIABLES"
              :key="v"
              class="text-[11px] font-mono px-2 py-0.5 rounded bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-colors"
              @click="insertVariable(v, 'bodyText')"
            >
              {{ v }}
            </button>
          </div>
        </div>
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
    <div v-if="templates.length === 0 && !showForm" class="border border-border rounded-lg px-5 py-8 bg-card text-center">
      <p class="text-sm text-muted-foreground">No templates yet.</p>
    </div>

    <!-- List -->
    <div v-else-if="templates.length > 0" class="border border-border rounded-lg overflow-hidden divide-y divide-border">
      <div v-for="t in templates" :key="t.id" class="bg-card">
        <div class="px-4 py-3 flex items-start gap-3">
          <button
            class="mt-0.5 text-muted-foreground hover:text-foreground transition-colors shrink-0"
            @click="expandedId = expandedId === t.id ? null : t.id"
          >
            <ChevronDown v-if="expandedId === t.id" :size="14" />
            <ChevronRight v-else :size="14" />
          </button>

          <div class="flex-1 min-w-0 cursor-pointer" @click="expandedId = expandedId === t.id ? null : t.id">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-medium text-foreground">{{ t.name }}</span>
              <span v-if="t.isDefault" class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary">Default</span>
              <span v-if="t.isSystem" class="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">System</span>
            </div>
            <p class="text-xs text-muted-foreground mt-0.5 line-clamp-2">{{ t.subject }}</p>
          </div>

          <div class="flex items-center gap-1 shrink-0">
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  class="flex items-center justify-center w-7 h-7 rounded transition-colors"
                  :class="t.isDefault ? 'text-primary' : 'text-muted-foreground hover:text-primary hover:bg-muted'"
                  @click="setDefault(t)"
                >
                  <Star :size="13" :class="t.isDefault ? 'fill-primary' : ''" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Set as default</TooltipContent>
            </Tooltip>
            <Tooltip v-if="!t.isSystem || isSuperuser">
              <TooltipTrigger as-child>
                <button
                  class="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  @click="openEdit(t)"
                >
                  <Pencil :size="13" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Edit</TooltipContent>
            </Tooltip>
            <Tooltip v-if="!t.isSystem">
              <TooltipTrigger as-child>
                <button
                  class="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  @click="requestRemove(t)"
                >
                  <Trash2 :size="13" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <!-- Expanded body preview -->
        <div v-if="expandedId === t.id" class="px-4 pb-4 border-t border-border/60 bg-muted/30">
          <p class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-3 mb-1.5">Subject</p>
          <p class="text-xs text-foreground font-mono">{{ t.subject }}</p>
          <p class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mt-3 mb-1.5">Body</p>
          <pre class="text-xs text-foreground font-mono whitespace-pre-wrap leading-relaxed">{{ t.bodyText }}</pre>
          <button
            v-if="!t.isSystem || isSuperuser"
            class="mt-3 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors"
            @click="openEdit(t)"
          >
            <Pencil :size="11" />
            Edit template
          </button>
        </div>
      </div>
    </div>

    <div class="border border-border rounded-lg bg-card/50">
      <button class="w-full flex items-center justify-between gap-2 p-4 text-left" @click="notesOpen = !notesOpen">
        <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Template Notes</p>
        <ChevronUp v-if="notesOpen" :size="14" class="text-muted-foreground" />
        <ChevronDown v-else :size="14" class="text-muted-foreground" />
      </button>
      <p v-if="notesOpen" class="px-4 pb-4 text-xs text-muted-foreground">
        System templates cannot be deleted. Administrators can edit them. Use variables like
        <code class="font-mono text-foreground/80">&#123;&#123;title&#125;&#125;</code>
        in subjects and bodies - they are replaced with book details at send time.
      </p>
    </div>

    <div v-if="deleteConfirm" class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4" @click.self="deleteConfirm = null">
      <button class="absolute inset-0 bg-black/45" @click="deleteConfirm = null" />
      <div class="relative w-full rounded-t-xl border border-border bg-card p-4 shadow-xl md:max-w-md md:rounded-xl md:p-5">
        <p class="text-base font-semibold text-foreground">Delete template?</p>
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
