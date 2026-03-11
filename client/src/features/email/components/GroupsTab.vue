<script setup lang="ts">
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Plus, Trash2, UserMinus, UserPlus, ChevronDown, ChevronRight } from 'lucide-vue-next'
import { useEmailGroups, type EmailGroup } from '../composables/useEmailGroups'
import { useEmailRecipients } from '../composables/useEmailRecipients'

const { groups, createGroup, deleteGroup, addMember, removeMember } = useEmailGroups()
const { recipients } = useEmailRecipients()

const showCreate = ref(false)
const newGroupName = ref('')
const creating = ref(false)
const createError = ref<string | null>(null)
const expandedGroupId = ref<number | null>(null)
const addingToGroupId = ref<number | null>(null)
const selectedRecipientId = ref<number | null>(null)

async function submitCreate() {
  if (!newGroupName.value.trim()) return
  creating.value = true
  createError.value = null
  try {
    await createGroup(newGroupName.value.trim())
    toast.success('Group created')
    newGroupName.value = ''
    showCreate.value = false
  } catch (e) {
    createError.value = e instanceof Error ? e.message : 'Failed to create group'
  } finally {
    creating.value = false
  }
}

async function remove(g: EmailGroup) {
  if (!confirm(`Delete group "${g.name}"?`)) return
  try {
    await deleteGroup(g.id)
    toast.success(`"${g.name}" deleted`)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to delete')
  }
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
    toast.success('Member added')
    addingToGroupId.value = null
    selectedRecipientId.value = null
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to add member')
  }
}

async function removeMemberFromGroup(group: EmailGroup, recipientId: number) {
  try {
    await removeMember(group.id, recipientId)
    toast.success('Member removed')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to remove member')
  }
}

function availableRecipients(group: EmailGroup) {
  const memberIds = new Set(group.members.map((m) => m.id))
  return recipients.value.filter((r) => !memberIds.has(r.id))
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Recipient Groups</p>
      <button
        v-if="!showCreate"
        class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        @click="showCreate = true"
      >
        <Plus :size="12" />
        Create group
      </button>
    </div>

    <!-- Create form -->
    <div v-if="showCreate" class="border border-border rounded-lg p-4 bg-card space-y-3">
      <p class="text-sm font-semibold text-foreground">New Group</p>
      <div>
        <label class="block text-xs font-medium text-muted-foreground mb-1.5">Group name</label>
        <input
          v-model="newGroupName"
          type="text"
          placeholder="e.g. Book Club"
          autofocus
          class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          @keydown.enter="submitCreate()"
          @keydown.esc="showCreate = false"
        />
      </div>
      <div v-if="createError" class="text-xs text-destructive">{{ createError }}</div>
      <div class="flex items-center gap-2">
        <button
          class="px-4 py-2 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          :disabled="creating || !newGroupName.trim()"
          @click="submitCreate()"
        >
          {{ creating ? 'Creating...' : 'Create' }}
        </button>
        <button
          class="px-4 py-2 text-xs font-medium rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors"
          @click="cancelCreate"
        >
          Cancel
        </button>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="groups.length === 0 && !showCreate" class="border border-border rounded-lg px-5 py-8 bg-card text-center">
      <p class="text-sm text-muted-foreground">No groups yet. Create a group to send to multiple recipients at once.</p>
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
            <span class="ml-2 text-xs text-muted-foreground">{{ g.members.length }} {{ g.members.length === 1 ? 'member' : 'members' }}</span>
          </div>
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                @click="remove(g)"
              >
                <Trash2 :size="13" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Delete group</TooltipContent>
          </Tooltip>
        </div>

        <!-- Expanded members -->
        <div v-if="expandedGroupId === g.id" class="border-t border-border bg-background/50">
          <div v-if="g.members.length === 0" class="px-8 py-3 text-xs text-muted-foreground">No members yet.</div>
          <div v-for="m in g.members" :key="m.id" class="flex items-center gap-3 px-8 py-2">
            <div class="flex-1 min-w-0">
              <span class="text-sm text-foreground">{{ m.name }}</span>
              <span class="text-xs text-muted-foreground ml-2">{{ m.email }}</span>
            </div>
            <button
              class="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
              @click="removeMemberFromGroup(g, m.id)"
            >
              <UserMinus :size="12" />
              Remove
            </button>
          </div>

          <!-- Add member -->
          <div class="px-8 py-3 border-t border-border/60">
            <div v-if="addingToGroupId === g.id" class="flex items-center gap-2">
              <select
                v-model="selectedRecipientId"
                class="flex-1 h-8 px-2 text-xs border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option :value="null" disabled>Select recipient...</option>
                <option v-for="r in availableRecipients(g)" :key="r.id" :value="r.id">{{ r.name }} ({{ r.email }})</option>
              </select>
              <button
                class="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                :disabled="!selectedRecipientId"
                @click="submitAddMember(g)"
              >
                Add
              </button>
              <button
                class="px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors"
                @click="addingToGroupId = null"
              >
                Cancel
              </button>
            </div>
            <button
              v-else-if="availableRecipients(g).length > 0"
              class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              @click="startAddMember(g.id)"
            >
              <UserPlus :size="12" />
              Add member
            </button>
            <p v-else class="text-xs text-muted-foreground/60">All recipients are already in this group.</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
