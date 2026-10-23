<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Check } from '@lucide/vue'
import type { EmailRecipient } from '@bookorbit/types'

import SettingsEditorSheet from '@/features/settings/components/SettingsEditorSheet.vue'
import SettingsField from '@/features/settings/components/SettingsField.vue'
import SettingsSection from '@/features/settings/components/SettingsSection.vue'
import EmailTile from './EmailTile.vue'
import { useEmailGroups, type EmailGroup } from '../composables/useEmailGroups'
import { deviceLook } from '../lib/email-devices'

const props = defineProps<{
  open: boolean
  /** Null to add one. */
  group: EmailGroup | null
  recipients: EmailRecipient[]
}>()

const emit = defineEmits<{ 'update:open': [open: boolean]; saved: [] }>()

const { t } = useI18n()
const { createGroup, updateGroup, deleteGroup, addMember, removeMember } = useEmailGroups()

const draft = reactive<{ name: string; members: number[] }>({ name: '', members: [] })
const initial = ref('')
const saving = ref(false)
const error = ref<string | null>(null)

watch(
  () => [props.open, props.group] as const,
  ([open]) => {
    if (!open) return
    draft.name = props.group?.name ?? ''
    draft.members = props.group ? props.group.members.map((m) => m.id) : []
    initial.value = JSON.stringify(draft)
    error.value = null
  },
  { immediate: true },
)

const dirty = computed(() => JSON.stringify(draft) !== initial.value)
const title = computed(() => props.group?.name || t('email.editor.group.newTitle'))

function toggleMember(id: number) {
  draft.members = draft.members.includes(id) ? draft.members.filter((m) => m !== id) : [...draft.members, id]
}

function close() {
  emit('update:open', false)
}

/** The server takes members one at a time, so a save adds and removes the difference. */
async function handleSave() {
  if (!draft.name.trim()) {
    error.value = t('email.editor.group.required')
    return
  }
  saving.value = true
  error.value = null
  try {
    let groupId: number
    let before: number[] = []
    if (props.group) {
      groupId = props.group.id
      before = props.group.members.map((m) => m.id)
      if (draft.name.trim() !== props.group.name) await updateGroup(groupId, { name: draft.name.trim() })
    } else {
      groupId = (await createGroup(draft.name.trim())).id
    }
    for (const id of draft.members.filter((m) => !before.includes(m))) await addMember(groupId, id)
    for (const id of before.filter((m) => !draft.members.includes(m))) await removeMember(groupId, id)
    toast.success(props.group ? t('email.editor.group.updated') : t('email.groups.created'))
    emit('saved')
    close()
  } catch (e) {
    error.value = e instanceof Error ? e.message : t('email.saveFailed')
  } finally {
    saving.value = false
  }
}

async function handleRemove() {
  if (!props.group) return
  saving.value = true
  try {
    await deleteGroup(props.group.id)
    toast.success(t('email.groups.deleted', { name: props.group.name }))
    close()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('email.deleteFailed'))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <SettingsEditorSheet
    :open="open"
    :title="title"
    :description="t('email.editor.group.description')"
    :dirty="dirty"
    :busy="saving"
    :removable="group !== null"
    :remove-label="t('email.editor.group.remove')"
    :remove-confirm="t('email.editor.group.removeConfirm', { name: group?.name ?? '' })"
    :remove-consequence="t('email.editor.group.removeConsequence')"
    @save="handleSave"
    @cancel="close"
    @remove="handleRemove"
  >
    <template #status>
      <p v-if="group" class="text-xs text-muted-foreground">{{ t('email.page.groupCount', { count: group.members.length }) }}</p>
    </template>

    <SettingsSection :title="t('email.editor.group.sectionGroup')">
      <SettingsField :label="t('email.editor.group.name')" input-id="email-group-name" required>
        <input
          id="email-group-name"
          v-model="draft.name"
          type="text"
          class="settings-control"
          autocomplete="off"
          :placeholder="t('email.groups.namePlaceholder')"
        />
      </SettingsField>
      <p v-if="error" role="alert" class="text-xs text-destructive">{{ error }}</p>
    </SettingsSection>

    <section class="flex flex-col gap-3">
      <div class="flex items-center gap-3">
        <h3 class="settings-group-label mb-0">{{ t('email.editor.group.sectionMembers') }}</h3>
        <span v-if="recipients.length" class="ms-auto text-xs tabular-nums text-muted-foreground">
          {{ t('email.editor.group.memberCount', { count: draft.members.length, total: recipients.length }) }}
        </span>
      </div>
      <div v-if="recipients.length === 0" class="settings-empty-state">
        <p class="text-sm font-medium text-foreground">{{ t('email.editor.group.noRecipientsTitle') }}</p>
        <p class="mt-1 text-xs text-muted-foreground">{{ t('email.editor.group.noRecipientsBody') }}</p>
      </div>
      <ul v-else class="flex flex-col gap-0.5" role="group" :aria-label="t('email.editor.group.sectionMembers')">
        <li v-for="recipient in recipients" :key="recipient.id">
          <button
            type="button"
            role="checkbox"
            :aria-checked="draft.members.includes(recipient.id)"
            class="grid w-full grid-cols-[18px_28px_minmax(0,1fr)] items-center gap-x-[11px] rounded-lg px-2 py-[7px] text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :class="draft.members.includes(recipient.id) ? 'bg-primary/9' : 'hover:bg-foreground/4'"
            @click="toggleMember(recipient.id)"
          >
            <span
              class="inline-flex size-4 items-center justify-center rounded-[4px] border-[1.5px]"
              :class="draft.members.includes(recipient.id) ? 'border-primary bg-primary text-primary-foreground' : 'border-input'"
              aria-hidden="true"
            >
              <Check v-if="draft.members.includes(recipient.id)" :size="12" :stroke-width="3" />
            </span>
            <EmailTile :icon="deviceLook(recipient.deviceType).icon" :color="deviceLook(recipient.deviceType).color" :size="28" />
            <span class="min-w-0 truncate text-sm leading-[1.45] font-medium text-foreground">{{ recipient.name }}</span>
            <span class="col-start-3 min-w-0 truncate text-xs leading-[1.45] text-muted-foreground" dir="ltr">{{ recipient.email }}</span>
          </button>
        </li>
      </ul>
    </section>
  </SettingsEditorSheet>
</template>
