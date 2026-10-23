<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Paperclip } from '@lucide/vue'
import type { EmailRecipient } from '@bookorbit/types'

import SettingsEditorSheet from '@/features/settings/components/SettingsEditorSheet.vue'
import SettingsField from '@/features/settings/components/SettingsField.vue'
import SettingsSection from '@/features/settings/components/SettingsSection.vue'
import type { EditorMenuAction } from '@/features/settings/lib/editor-actions'
import BookFormatChip from '@/features/book/components/BookFormatChip.vue'
import { formatBytes } from '@/lib/formatting'
import EmailTokenField from './EmailTokenField.vue'
import { useEmailTemplates, type EmailTemplate, type TemplateTextPreview } from '../composables/useEmailTemplates'
import { useEmailPreferences } from '../composables/useEmailPreferences'

export interface PreviewBook {
  id: number
  title: string
}

const props = defineProps<{
  open: boolean
  /** Null to add one. */
  template: EmailTemplate | null
  isDefault: boolean
  isSuperuser: boolean
  /** Books the account has sent, newest first; the preview renders against one of them. */
  previewBooks: PreviewBook[]
  /** Who the preview is addressed to: the Quick send recipient when it reads messages. */
  previewRecipient: EmailRecipient | null
  /** A new template starts as a copy of this one, the built-in template, rather than empty. */
  starter: EmailTemplate | null
}>()

const emit = defineEmits<{ 'update:open': [open: boolean]; saved: [template: EmailTemplate] }>()

const { t } = useI18n()
const { createTemplate, updateTemplate, deleteTemplate, previewTemplateText } = useEmailTemplates()
const { savePreferences } = useEmailPreferences()

const VARIABLE_GROUPS = [
  {
    key: 'groupBook',
    names: ['title', 'subtitle', 'author', 'series', 'seriesIndex', 'publishedYear', 'publisher', 'pageCount', 'language', 'isbn', 'tags'],
  },
  { key: 'groupFile', names: ['format', 'fileSize'] },
  { key: 'groupOther', names: ['senderName', 'coverUrl', 'appUrl'] },
] as const

const draft = reactive({ name: '', subject: '', bodyText: '' })
const initial = ref('')
const saving = ref(false)
const error = ref<string | null>(null)
const subjectInput = ref<InstanceType<typeof EmailTokenField> | null>(null)
const bodyInput = ref<InstanceType<typeof EmailTokenField> | null>(null)
/** Where a variable chip types into: the field that had focus last. */
const target = ref<'subject' | 'bodyText'>('bodyText')
const previewBookId = ref<number | null>(null)
const preview = ref<TemplateTextPreview | null>(null)
const previewFailed = ref(false)
let previewTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => [props.open, props.template] as const,
  ([open]) => {
    if (!open) return
    Object.assign(
      draft,
      props.template
        ? { name: props.template.name, subject: props.template.subject, bodyText: props.template.bodyText }
        : { name: '', subject: props.starter?.subject ?? '', bodyText: props.starter?.bodyText ?? '' },
    )
    initial.value = JSON.stringify(draft)
    error.value = null
    previewBookId.value = props.previewBooks[0]?.id ?? null
  },
  { immediate: true },
)

const dirty = computed(() => JSON.stringify(draft) !== initial.value)
const readonly = computed(() => Boolean(props.template?.isSystem) && !props.isSuperuser)
const title = computed(() => props.template?.name || t('email.editor.template.newTitle'))
const showTo = computed(() => props.previewRecipient && props.previewRecipient.deviceType !== 'kindle')

const menuActions = computed<EditorMenuAction[]>(() =>
  props.template && !props.isDefault ? [{ id: 'make-default', label: t('email.editor.template.makeDefault') }] : [],
)

function schedulePreview() {
  if (previewTimer) clearTimeout(previewTimer)
  if (!props.open || previewBookId.value === null) return
  const bookId = previewBookId.value
  previewTimer = setTimeout(async () => {
    try {
      preview.value = await previewTemplateText(draft.subject, draft.bodyText, bookId)
      previewFailed.value = false
    } catch {
      previewFailed.value = true
    }
  }, 350)
}

watch(() => [props.open, draft.subject, draft.bodyText, previewBookId.value], schedulePreview, { immediate: true })
onBeforeUnmount(() => {
  if (previewTimer) clearTimeout(previewTimer)
})

function focusSubject() {
  target.value = 'subject'
}
function focusBody() {
  target.value = 'bodyText'
}

async function insertVariable(name: string) {
  if (readonly.value) return
  const token = `{{${name}}}`
  const field = (target.value === 'subject' ? subjectInput.value : bodyInput.value)?.field ?? null
  const value = draft[target.value]
  const start = field?.selectionStart ?? value.length
  const end = field?.selectionEnd ?? value.length
  draft[target.value] = value.slice(0, start) + token + value.slice(end)
  await nextTick()
  field?.focus()
  field?.setSelectionRange(start + token.length, start + token.length)
}

function close() {
  emit('update:open', false)
}

async function handleSave() {
  if (readonly.value) return close()
  if (!draft.name.trim() || !draft.subject.trim()) {
    error.value = t('email.editor.template.required')
    return
  }
  saving.value = true
  error.value = null
  try {
    const form = { name: draft.name.trim(), subject: draft.subject, bodyText: draft.bodyText }
    const saved = props.template ? await updateTemplate(props.template.id, form) : await createTemplate(form)
    toast.success(props.template ? t('email.templates.updated') : t('email.templates.created'))
    emit('saved', saved)
    close()
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('email.saveFailed')
  } finally {
    saving.value = false
  }
}

async function handleRemove() {
  if (!props.template) return
  saving.value = true
  try {
    await deleteTemplate(props.template.id)
    toast.success(t('email.templates.deleted', { name: props.template.name }))
    close()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('email.deleteFailed'))
  } finally {
    saving.value = false
  }
}

async function handleAction(id: string) {
  if (id !== 'make-default' || !props.template) return
  try {
    await savePreferences({ defaultTemplateId: props.template.id })
    toast.success(t('email.route.defaultSaved'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('email.setDefaultFailed'))
  }
}
</script>

<template>
  <SettingsEditorSheet
    :open="open"
    :title="title"
    :description="t('email.editor.template.description')"
    :dirty="dirty && !readonly"
    :busy="saving"
    :removable="template !== null && !template.isSystem"
    :remove-label="t('email.editor.template.remove')"
    :remove-confirm="t('email.editor.template.removeConfirm', { name: template?.name ?? '' })"
    :remove-consequence="t('email.editor.template.removeConsequence')"
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
      <span v-if="template?.isSystem" class="rounded-xs bg-muted px-1.5 text-[10px] leading-[18px] font-semibold text-muted-foreground">{{
        t('email.page.builtIn')
      }}</span>
    </template>
    <template #status>
      <p v-if="readonly" class="text-xs text-muted-foreground">{{ t('email.editor.template.builtInReadonly') }}</p>
    </template>

    <SettingsSection :title="t('email.editor.template.sectionTemplate')">
      <SettingsField :label="t('email.editor.template.name')" input-id="email-template-name" required>
        <input
          id="email-template-name"
          v-model="draft.name"
          type="text"
          class="settings-control"
          autocomplete="off"
          :disabled="readonly"
          :placeholder="t('email.templates.namePlaceholder')"
        />
      </SettingsField>
      <SettingsField :label="t('email.editor.template.subject')" input-id="email-template-subject" required>
        <EmailTokenField id="email-template-subject" ref="subjectInput" v-model="draft.subject" :disabled="readonly" @focus="focusSubject" />
      </SettingsField>
      <SettingsField :label="t('email.editor.template.message')" input-id="email-template-body">
        <EmailTokenField
          id="email-template-body"
          ref="bodyInput"
          v-model="draft.bodyText"
          multiline
          :rows="7"
          :disabled="readonly"
          @focus="focusBody"
        />
      </SettingsField>
      <p v-if="error" role="alert" class="text-xs text-destructive">{{ error }}</p>
    </SettingsSection>

    <SettingsSection v-if="!readonly" :title="t('email.editor.template.sectionInsert')">
      <div class="flex flex-col gap-2">
        <div v-for="group in VARIABLE_GROUPS" :key="group.key" class="flex flex-wrap items-center gap-1.5">
          <span class="w-14 shrink-0 text-[11.5px] text-muted-foreground">{{ t(`email.editor.template.${group.key}`) }}</span>
          <button
            v-for="name in group.names"
            :key="name"
            type="button"
            class="rounded-md border border-border bg-foreground/4 px-1.5 font-mono text-[11.5px] leading-[18px] text-foreground transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :aria-label="t('email.editor.template.insertVariable', { variable: name })"
            @mousedown.prevent
            @click="insertVariable(name)"
          >
            {{ name }}
          </button>
        </div>
        <p class="text-xs text-muted-foreground">{{ t('email.editor.template.insertHint') }}</p>
      </div>
    </SettingsSection>

    <section class="flex flex-col gap-3">
      <div class="flex min-h-8 items-center gap-3">
        <h3 class="settings-group-label mb-0">{{ t('email.editor.template.sectionPreview') }}</h3>
        <select
          v-if="previewBooks.length > 0"
          v-model="previewBookId"
          class="settings-control ms-auto h-8 w-60 text-[13px]"
          :aria-label="t('email.editor.template.previewWith')"
        >
          <option v-for="book in previewBooks" :key="book.id" :value="book.id">{{ book.title }}</option>
        </select>
      </div>
      <p v-if="previewBooks.length === 0" class="text-xs text-muted-foreground">{{ t('email.editor.template.previewEmpty') }}</p>
      <template v-else>
        <div class="overflow-hidden rounded-lg border border-border bg-background/55" aria-live="polite">
          <div class="grid grid-cols-[56px_minmax(0,1fr)] gap-x-2.5 gap-y-1 border-b border-border px-3.5 py-2.5 text-[12.5px]">
            <template v-if="showTo">
              <span class="text-muted-foreground">{{ t('email.editor.template.previewTo') }}</span>
              <span class="truncate text-foreground">{{ previewRecipient?.name }} &lt;{{ previewRecipient?.email }}&gt;</span>
            </template>
            <span class="text-muted-foreground">{{ t('email.editor.template.subject') }}</span>
            <span class="truncate text-[13.5px] font-semibold text-foreground">{{ preview?.subject ?? '' }}</span>
          </div>
          <p v-if="previewFailed" class="px-3.5 py-3 text-xs text-destructive">{{ t('email.editor.template.previewFailed') }}</p>
          <div v-else class="px-3.5 pt-3 pb-3.5">
            <p class="text-[13px] leading-relaxed whitespace-pre-wrap text-foreground">{{ preview?.bodyText ?? '' }}</p>
            <p
              v-if="preview?.attachment"
              class="mt-3 inline-flex max-w-full items-center gap-[9px] rounded-[9px] border border-border bg-card py-1.5 ps-2 pe-2.5 text-[12.5px]"
              :aria-label="t('email.editor.template.attachment', { name: preview.attachment.fileName })"
            >
              <Paperclip :size="15" class="shrink-0 text-muted-foreground" aria-hidden="true" />
              <BookFormatChip
                v-if="preview.attachment.format"
                :format-key="preview.attachment.format"
                class="rounded-[5px] px-1.5 py-0 text-[11px] leading-[17px] tracking-[0.02em]"
              />
              <span class="min-w-0 truncate font-medium text-foreground">{{ preview.attachment.fileName }}</span>
              <span v-if="preview.attachment.sizeBytes" class="shrink-0 whitespace-nowrap text-muted-foreground">{{
                formatBytes(preview.attachment.sizeBytes)
              }}</span>
            </p>
          </div>
        </div>
      </template>
    </section>
  </SettingsEditorSheet>
</template>
