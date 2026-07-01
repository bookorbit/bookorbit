<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Plus, Trash2, UserMinus, UserPlus, ChevronDown, ChevronRight } from '@lucide/vue'
import { useEmailGroups, type EmailGroup } from '../composables/useEmailGroups'
import { useEmailRecipients } from '../composables/useEmailRecipients'

const { t } = useI18n()
const { groups, createGroup, deleteGroup, addMember, removeMember } = useEmailGroups()
const { recipients } = useEmailRecipients()

const showCreate = ref(false)
const newGroupName = ref('')
const creating = ref(false)
const createError = ref<string | null>(null)
const expandedGroupId = ref<number | null>(null)
const addingToGroupId = ref<number | null>(null)
const selectedRecipientId = ref<number | null>(null)
const deleteConfirm = ref<EmailGroup | null>(null)

async function submitCreate() {
  if (!newGroupName.value.trim()) return
  creating.value = true
  createError.value = null
  try {
    await createGroup(newGroupName.value.trim())
    toast.success(t('email.groups.created'))
    newGroupName.value = ''
    showCreate.value = false
  } catch (e) {
    createError.value = e instanceof Error ? e.message : t('email.groups.createFailed')
  } finally {
    creating.value = false
  }
}

async function remove(g: EmailGroup) {
  try {
    await deleteGroup(g.id)
    toast.success(t('email.groups.deleted', { name: g.name }))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('email.deleteFailed'))
  }
}

function requestRemove(g: EmailGroup) {
  deleteConfirm.value = g
}

async function confirmRemove() {
  if (!deleteConfirm.value) return
  const group = deleteConfirm.value
  deleteConfirm.value = null
  await remove(group)
}

function cancelCreate() {
  showCreate.value = false
  newGroupName.value = ''
}

function toggleExpand(id: number) {
  expandedGroupId.value = expandedGroupId.value === id ? null : id
  if (expandedGroupId.value !== id) addingToGroupId.value = null
}

function startAddMember(groupId: number) {
  addingToGroupId.value = groupId
  selectedRecipientId.value = null
}

async function submitAddMember(group: EmailGroup) {
  if (!selectedRecipientId.value) return
  try {
    await addMember(group.id, selectedRecipientId.value)
    toast.success(t('email.groups.memberAdded'))
    addingToGroupId.value = null
    selectedRecipientId.value = null
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('email.groups.addMemberFailed'))
  }
}

async function removeMemberFromGroup(group: EmailGroup, recipientId: number) {
  try {
    await removeMember(group.id, recipientId)
    toast.success(t('email.groups.memberRemoved'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('email.groups.removeMemberFailed'))
  }
}

function availableRecipients(group: EmailGroup) {
  const memberIds = new Set(group.members.map((m) => m.id))
  return recipients.value.filter((r) => !memberIds.has(r.id))
}
</script>

<template>
  <div class="space-y-4">
    <div class="hidden md:flex items-center justify-between">
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{{ t('email.groups.heading') }}</p>
      <button
        v-if="!showCreate"
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        @click="showCreate = true"
      >
        <Plus :size="12" />
        {{ t('email.groups.create') }}
      </button>
    </div>
    <div class="md:hidden flex items-center justify-between">
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{{ t('email.groups.heading') }}</p>
    </div>
    <div v-if="!showCreate" class="md:hidden sticky top-11 z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2">
      <button
        class="w-full min-h-10 flex items-center justify-center gap-1.5 px-3 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        @click="showCreate = true"
      >
        <Plus :size="13" />
        {{ t('email.groups.create') }}
      </button>
    </div>

    <!-- Create form -->
    <div v-if="showCreate" class="border border-border rounded-lg p-4 bg-card space-y-3">
      <p class="text-sm font-semibold text-foreground">{{ t('email.groups.newTitle') }}</p>
      <div>
        <label class="block text-xs font-medium text-muted-foreground mb-1.5">{{ t('email.groups.name') }}</label>
        <input
          v-model="newGroupName"
          type="text"
          :placeholder="t('email.groups.namePlaceholder')"
          autofocus
          class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          @keydown.enter="submitCreate()"
          @keydown.esc="showCreate = false"
        />
      </div>
      <div v-if="createError" class="text-xs text-destructive">{{ createError }}</div>
      <div class="hidden md:flex items-center gap-2">
        <button
          class="px-4 py-2 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          :disabled="creating || !newGroupName.trim()"
          @click="submitCreate()"
        >
          {{ creating ? t('email.groups.creating') : t('email.create') }}
        </button>
        <button
          class="px-4 py-2 text-xs font-medium rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors"
          @click="cancelCreate"
        >
          {{ t('common.cancel') }}
        </button>
      </div>
      <div class="md:hidden sticky bottom-2 z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2">
        <div class="flex items-center gap-2">
          <button class="settings-btn-primary flex-1 min-h-10 justify-center" :disabled="creating || !newGroupName.trim()" @click="submitCreate()">
            {{ creating ? t('email.groups.creating') : t('email.create') }}
          </button>
          <button
            class="rounded-md border border-border px-3 min-h-10 text-sm text-foreground hover:bg-muted transition-colors"
            @click="cancelCreate"
          >
            {{ t('common.cancel') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="groups.length === 0 && !showCreate" class="border border-border rounded-lg px-5 py-8 bg-card text-center">
      <p class="text-sm text-muted-foreground">{{ t('email.groups.empty') }}</p>
    </div>

    <!-- Groups list -->
    <div v-else-if="groups.length > 0" class="border border-border rounded-lg overflow-hidden divide-y divide-border">
      <div v-for="g in groups" :key="g.id" class="bg-card">
        <!-- Group header -->
        <div class="px-4 py-3 flex items-center gap-3">
          <button class="text-muted-foreground hover:text-foreground transition-colors" @click="toggleExpand(g.id)">
            <ChevronDown v-if="expandedGroupId === g.id" :size="14" />
            <ChevronRight v-else :size="14" />
          </button>
          <div class="flex-1 min-w-0">
            <span class="text-sm font-medium text-foreground">{{ g.name }}</span>
            <span class="ml-2 text-xs text-muted-foreground">{{ t('email.groups.memberCount', { count: g.members.length }, g.members.length) }}</span>
          </div>
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                @click="requestRemove(g)"
              >
                <Trash2 :size="13" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{{ t('email.groups.deleteTooltip') }}</TooltipContent>
          </Tooltip>
        </div>

        <!-- Expanded members -->
        <div v-if="expandedGroupId === g.id" class="border-t border-border bg-background/50">
          <div v-if="g.members.length === 0" class="px-8 py-3 text-xs text-muted-foreground">{{ t('email.groups.noMembers') }}</div>
          <div v-for="m in g.members" :key="m.id" class="flex items-start md:items-center gap-3 px-4 md:px-8 py-2">
            <div class="flex-1 min-w-0">
              <span class="text-sm text-foreground">{{ m.name }}</span>
              <span class="text-xs text-muted-foreground ml-2 line-clamp-1">{{ m.email }}</span>
            </div>
            <button
              class="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
              @click="removeMemberFromGroup(g, m.id)"
            >
              <UserMinus :size="12" />
              {{ t('email.groups.removeMember') }}
            </button>
          </div>

          <!-- Add member -->
          <div class="px-4 md:px-8 py-3 border-t border-border/60">
            <div v-if="addingToGroupId === g.id" class="flex items-center gap-2">
              <select
                v-model="selectedRecipientId"
                class="flex-1 h-8 px-2 text-xs border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option :value="null" disabled>{{ t('email.groups.selectRecipient') }}</option>
                <option v-for="r in availableRecipients(g)" :key="r.id" :value="r.id">{{ r.name }} ({{ r.email }})</option>
              </select>
              <button
                class="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                :disabled="!selectedRecipientId"
                @click="submitAddMember(g)"
              >
                {{ t('email.groups.add') }}
              </button>
              <button
                class="px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors"
                @click="addingToGroupId = null"
              >
                {{ t('common.cancel') }}
              </button>
            </div>
            <button
              v-else-if="availableRecipients(g).length > 0"
              class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              @click="startAddMember(g.id)"
            >
              <UserPlus :size="12" />
              {{ t('email.groups.addMember') }}
            </button>
            <p v-else class="text-xs text-muted-foreground/80">{{ t('email.groups.allRecipientsInGroup') }}</p>
          </div>
        </div>
      </div>
    </div>

    <div v-if="deleteConfirm" class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4" @click.self="deleteConfirm = null">
      <button class="absolute inset-0 bg-black/45" @click="deleteConfirm = null" />
      <div class="relative w-full rounded-t-xl border border-border bg-card p-4 shadow-xl md:max-w-md md:rounded-lg md:p-5">
        <p class="text-base font-semibold text-foreground">{{ t('email.groups.deleteTitle') }}</p>
        <p class="mt-1 text-sm text-muted-foreground">{{ t('email.deleteConfirm', { name: deleteConfirm.name }) }}</p>
        <div class="mt-4 flex items-center justify-end gap-2">
          <button
            class="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
            @click="deleteConfirm = null"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="rounded-md bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
            @click="confirmRemove"
          >
            {{ t('common.delete') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
