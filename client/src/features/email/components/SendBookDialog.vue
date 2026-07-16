<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { X, Send, Loader2 } from '@lucide/vue'
import { useEmailProviders } from '../composables/useEmailProviders'
import { useEmailRecipients } from '../composables/useEmailRecipients'
import { useEmailGroups } from '../composables/useEmailGroups'
import { useEmailTemplates } from '../composables/useEmailTemplates'
import { useEmailSend } from '../composables/useEmailSend'
import type { BookSelectionPayload } from '@bookorbit/types'

interface BookFile {
  id: number
  format: string | null
  role: string
}

const props = defineProps<{
  open: boolean
  selectionPayload: BookSelectionPayload
  selectedCount?: number
  bookFiles?: BookFile[]
  bookTitle?: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  sent: []
}>()

const { t } = useI18n()
const { providers, fetchProviders } = useEmailProviders()
const { recipients, fetchRecipients } = useEmailRecipients()
const { groups, fetchGroups } = useEmailGroups()
const { templates, fetchTemplates } = useEmailTemplates()
const { sendBook } = useEmailSend()

const selectedRecipientIds = ref<number[]>([])
const selectedGroupIds = ref<number[]>([])
const selectedProviderId = ref<number | null>(null)
const selectedTemplateId = ref<number | null>(null)
const selectedFileId = ref<number | null>(null)
const sending = ref(false)

const hasSelection = computed(() => selectedRecipientIds.value.length > 0 || selectedGroupIds.value.length > 0)

function selectionCount(): number {
  const bookIds = props.selectionPayload.bookIds
  return props.selectedCount ?? (Array.isArray(bookIds) ? bookIds.length : 0)
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      selectedRecipientIds.value = []
      selectedGroupIds.value = []
      selectedProviderId.value = null
      selectedTemplateId.value = null
      selectedFileId.value = null
      fetchRecipients().catch(() => {})
      fetchGroups().catch(() => {})
      fetchProviders().catch(() => {})
      fetchTemplates().catch(() => {})
    }
  },
  { immediate: true },
)

function toggleRecipient(id: number) {
  const idx = selectedRecipientIds.value.indexOf(id)
  if (idx >= 0) {
    selectedRecipientIds.value = selectedRecipientIds.value.filter((x) => x !== id)
  } else {
    selectedRecipientIds.value = [...selectedRecipientIds.value, id]
  }
}

function toggleGroup(id: number) {
  const idx = selectedGroupIds.value.indexOf(id)
  if (idx >= 0) {
    selectedGroupIds.value = selectedGroupIds.value.filter((x) => x !== id)
  } else {
    selectedGroupIds.value = [...selectedGroupIds.value, id]
  }
}

async function send() {
  if (!hasSelection.value) return
  sending.value = true
  try {
    const result = await sendBook({
      ...props.selectionPayload,
      recipientIds: selectedRecipientIds.value.length > 0 ? selectedRecipientIds.value : undefined,
      groupIds: selectedGroupIds.value.length > 0 ? selectedGroupIds.value : undefined,
      providerId: selectedProviderId.value ?? undefined,
      templateId: selectedTemplateId.value ?? undefined,
      fileId: selectedFileId.value ?? undefined,
    })
    toast.success(t('email.send.queued', { count: result.queued }, result.queued))
    emit('update:open', false)
    emit('sent')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('email.send.failed'))
  } finally {
    sending.value = false
  }
}

function close() {
  emit('update:open', false)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog-fade">
      <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div class="absolute inset-0 bg-black/50 backdrop-blur-[1px]" @click="close()" />

        <div class="relative w-full max-w-md bg-background border border-border rounded-lg shadow-2xl overflow-hidden">
          <!-- Header -->
          <div class="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <h2 class="text-sm font-semibold text-foreground">{{ t('email.send.title') }}</h2>
              <p v-if="bookTitle" class="text-xs text-muted-foreground mt-0.5 truncate max-w-[280px]">{{ bookTitle }}</p>
              <p v-else-if="selectionCount() > 1" class="text-xs text-muted-foreground mt-0.5">
                {{ t('email.send.bookCount', { count: selectionCount() }, selectionCount()) }}
              </p>
            </div>
            <button class="text-muted-foreground hover:text-foreground transition-colors" @click="close()">
              <X :size="16" />
            </button>
          </div>

          <!-- Body -->
          <div class="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
            <!-- Recipients -->
            <div>
              <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{{ t('email.send.recipients') }}</p>
              <div v-if="recipients.length === 0" class="text-xs text-muted-foreground">{{ t('email.send.noRecipients') }}</div>
              <div v-else class="space-y-1">
                <label
                  v-for="r in recipients"
                  :key="r.id"
                  class="flex items-center gap-2.5 px-3 py-2 rounded-md cursor-pointer hover:bg-muted/50 transition-colors"
                  :class="selectedRecipientIds.includes(r.id) ? 'bg-primary/8' : ''"
                >
                  <input
                    type="checkbox"
                    :checked="selectedRecipientIds.includes(r.id)"
                    class="rounded border-border text-primary"
                    @change="toggleRecipient(r.id)"
                  />
                  <div class="flex-1 min-w-0">
                    <p class="text-sm text-foreground">{{ r.name }}</p>
                    <p class="text-xs text-muted-foreground truncate">{{ r.email }}</p>
                  </div>
                  <span v-if="r.isDefault" class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/15 text-primary">{{
                    t('email.badge.default')
                  }}</span>
                </label>
              </div>
            </div>

            <!-- Groups -->
            <div v-if="groups.length > 0">
              <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{{ t('email.send.groups') }}</p>
              <div class="space-y-1">
                <label
                  v-for="g in groups"
                  :key="g.id"
                  class="flex items-center gap-2.5 px-3 py-2 rounded-md cursor-pointer hover:bg-muted/50 transition-colors"
                  :class="selectedGroupIds.includes(g.id) ? 'bg-primary/8' : ''"
                >
                  <input
                    type="checkbox"
                    :checked="selectedGroupIds.includes(g.id)"
                    class="rounded border-border text-primary"
                    @change="toggleGroup(g.id)"
                  />
                  <div class="flex-1 min-w-0">
                    <p class="text-sm text-foreground">{{ g.name }}</p>
                    <p class="text-xs text-muted-foreground">{{ t('email.groups.memberCount', { count: g.members.length }, g.members.length) }}</p>
                  </div>
                </label>
              </div>
            </div>

            <!-- Advanced options -->
            <details class="group">
              <summary
                class="text-xs font-semibold text-muted-foreground uppercase tracking-wider cursor-pointer hover:text-foreground transition-colors list-none flex items-center gap-1"
              >
                <span>{{ t('email.send.options') }}</span>
                <span class="text-muted-foreground/70 group-open:rotate-90 transition-transform inline-block">›</span>
              </summary>
              <div class="mt-3 space-y-3">
                <!-- File picker -->
                <div v-if="bookFiles && bookFiles.length > 1">
                  <label class="block text-xs font-medium text-muted-foreground mb-1.5">{{ t('email.send.fileFormat') }}</label>
                  <select
                    v-model="selectedFileId"
                    class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option :value="null">{{ t('email.send.autoRecipientPreference') }}</option>
                    <option v-for="f in bookFiles" :key="f.id" :value="f.id">
                      {{ f.format?.toUpperCase() ?? t('email.send.unknownFormat')
                      }}{{ f.role === 'primary' ? ` ${t('email.send.primarySuffix')}` : '' }}
                    </option>
                  </select>
                </div>

                <!-- Provider picker -->
                <div v-if="providers.length > 0">
                  <label class="block text-xs font-medium text-muted-foreground mb-1.5">{{ t('email.send.provider') }}</label>
                  <select
                    v-model="selectedProviderId"
                    class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option :value="null">{{ t('email.send.default') }}</option>
                    <option v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</option>
                  </select>
                </div>

                <!-- Template picker -->
                <div v-if="providers.length > 0">
                  <label class="block text-xs font-medium text-muted-foreground mb-1.5">{{ t('email.send.template') }}</label>
                  <select
                    v-model="selectedTemplateId"
                    class="w-full h-9 px-3 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option :value="null">{{ t('email.send.default') }}</option>
                    <option v-for="t in templates" :key="t.id" :value="t.id">{{ t.name }}</option>
                  </select>
                </div>
              </div>
            </details>
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
            <button
              class="px-4 py-2 text-xs font-medium rounded-md border border-border bg-background text-foreground hover:bg-muted transition-colors"
              @click="close()"
            >
              {{ t('common.cancel') }}
            </button>
            <button
              class="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              :disabled="sending || !hasSelection"
              @click="send()"
            >
              <Loader2 v-if="sending" :size="12" class="animate-spin" />
              <Send v-else :size="12" />
              {{ sending ? t('email.send.sending') : t('email.send.send') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 0.15s ease;
}
.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}
</style>
