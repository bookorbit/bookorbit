<script setup lang="ts">
import { Button } from '@/components/ui/button'
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
function beginCreate() {
  showCreate.value = true
}

function cancelAddingMember() {
  addingToGroupId.value = null
}

function cancelDelete() {
  deleteConfirm.value = null
}
</script>

<template>
  <div class="space-y-4">
    <div class="hidden md:flex items-center justify-between">
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{{ t('email.groups.heading') }}</p>
      <Button size="sm" v-if="!showCreate" @click="beginCreate">
        <Plus :size="12" />
        {{ t('email.groups.create') }}
      </Button>
    </div>
    <div class="md:hidden flex items-center justify-between">
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{{ t('email.groups.heading') }}</p>
    </div>
    <div v-if="!showCreate" class="md:hidden sticky top-11 z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2">
      <Button size="sm" class="w-full min-h-10" @click="beginCreate">
        <Plus :size="13" />
        {{ t('email.groups.create') }}
      </Button>
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
        <Button size="sm" :disabled="creating || !newGroupName.trim()" @click="submitCreate">
          {{ creating ? t('email.groups.creating') : t('email.create') }}
        </Button>
        <Button variant="outline" size="sm" @click="cancelCreate">
          {{ t('common.cancel') }}
        </Button>
      </div>
      <div class="md:hidden sticky bottom-2 z-20 border border-border/60 bg-card/95 backdrop-blur rounded-lg px-3 py-2">
        <div class="flex items-center gap-2">
          <Button size="sm" class="flex-1 min-h-10" :disabled="creating || !newGroupName.trim()" @click="submitCreate" type="button">
            {{ creating ? t('email.groups.creating') : t('email.create') }}
          </Button>
          <Button variant="outline" size="sm" class="min-h-10" @click="cancelCreate">
            {{ t('common.cancel') }}
          </Button>
        </div>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="groups.length === 0 && !showCreate" class="settings-empty-state">
      <p class="text-sm text-muted-foreground">{{ t('email.groups.empty') }}</p>
    </div>

    <!-- Groups list -->
    <div v-else-if="groups.length > 0" class="settings-card">
      <div v-for="g in groups" :key="g.id" class="bg-card">
        <!-- Group header -->
        <div class="px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" @click="toggleExpand(g.id)">
            <ChevronDown v-if="expandedGroupId === g.id" :size="14" />
            <ChevronRight v-else :size="14" />
          </Button>
          <div class="flex-1 min-w-0">
            <span class="text-sm font-medium text-foreground">{{ g.name }}</span>
            <span class="ml-2 text-xs text-muted-foreground">{{ t('email.groups.memberCount', { count: g.members.length }) }}</span>
          </div>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button variant="destructive-ghost" size="icon-sm" @click="requestRemove(g)">
                <Trash2 :size="13" />
              </Button>
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
            <Button variant="destructive-ghost" size="sm" @click="removeMemberFromGroup(g, m.id)">
              <UserMinus :size="12" />
              {{ t('email.groups.removeMember') }}
            </Button>
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
              <Button size="sm" :disabled="!selectedRecipientId" @click="submitAddMember(g)">
                {{ t('email.groups.add') }}
              </Button>
              <Button variant="outline" size="sm" @click="cancelAddingMember">
                {{ t('common.cancel') }}
              </Button>
            </div>
            <Button v-else-if="availableRecipients(g).length > 0" variant="ghost" size="sm" @click="startAddMember(g.id)">
              <UserPlus :size="12" />
              {{ t('email.groups.addMember') }}
            </Button>
            <p v-else class="text-xs text-muted-foreground">{{ t('email.groups.allRecipientsInGroup') }}</p>
          </div>
        </div>
      </div>
    </div>

    <div v-if="deleteConfirm" class="fixed inset-0 z-[70] flex items-end justify-center md:items-center md:px-4" @click.self="deleteConfirm = null">
      <button class="absolute inset-0 bg-black/45" @click="cancelDelete" />
      <div class="relative w-full rounded-t-xl border border-border bg-card p-4 shadow-xl md:max-w-md md:rounded-lg md:p-5">
        <p class="text-base font-semibold text-foreground">{{ t('email.groups.deleteTitle') }}</p>
        <p class="mt-1 text-sm text-muted-foreground">{{ t('email.deleteConfirm', { name: deleteConfirm.name }) }}</p>
        <div class="mt-4 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" @click="cancelDelete">
            {{ t('common.cancel') }}
          </Button>
          <Button variant="destructive" size="sm" @click="confirmRemove">
            {{ t('common.delete') }}
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
