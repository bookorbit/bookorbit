<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Trash2, RefreshCw } from 'lucide-vue-next'
import { useEmailSendLog, type EmailSendLogEntry } from '../composables/useEmailSendLog'

const { logEntries, fetchLog, deleteEntry, resendEntry } = useEmailSendLog()

const loading = ref(true)
const page = ref(0)
const PAGE_SIZE = 20
const resending = ref<number | null>(null)

onMounted(async () => {
  try {
    await fetchLog(page.value, PAGE_SIZE)
  } finally {
    loading.value = false
  }
})

async function loadMore() {
  page.value++
  await fetchLog(page.value, PAGE_SIZE)
}

async function remove(entry: EmailSendLogEntry) {
  try {
    await deleteEntry(entry.id)
    toast.success('Entry deleted')
  } catch {
    toast.error('Failed to delete')
  }
}

async function resend(entry: EmailSendLogEntry) {
  resending.value = entry.id
  try {
    await resendEntry(entry.id)
    toast.success('Queued for resend')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Failed to resend')
  } finally {
    resending.value = null
  }
}

function formatDate(date: string): string {
  return new Date(date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function statusClass(status: string): string {
  if (status === 'sent') return 'bg-green-500/15 text-green-600 dark:text-green-400'
  if (status === 'failed') return 'bg-destructive/15 text-destructive'
  return 'bg-muted text-muted-foreground'
}
</script>

<template>
  <div class="space-y-4">
    <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Send History</p>

    <div v-if="loading" class="text-sm text-muted-foreground">Loading...</div>

    <div v-else-if="logEntries.length === 0" class="border border-border rounded-lg px-5 py-8 bg-card text-center">
      <p class="text-sm text-muted-foreground">No emails sent yet.</p>
    </div>

    <div v-else class="border border-border rounded-lg overflow-hidden divide-y divide-border">
      <div v-for="entry in logEntries" :key="entry.id" class="px-4 py-3 bg-card flex items-start gap-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap mb-0.5">
            <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide" :class="statusClass(entry.status)">
              {{ entry.status }}
            </span>
            <span class="text-sm text-foreground truncate">{{ entry.toName || entry.toEmail }}</span>
          </div>
          <p class="text-xs text-muted-foreground truncate">
            {{ entry.subject ?? '(no subject)' }}
          </p>
          <p class="text-xs text-muted-foreground mt-0.5">{{ formatDate(entry.createdAt) }}</p>
          <p v-if="entry.errorMessage" class="text-xs text-destructive mt-0.5 truncate">{{ entry.errorMessage }}</p>
        </div>

        <div class="flex items-center gap-1 shrink-0">
          <Tooltip v-if="entry.status === 'failed'">
            <TooltipTrigger as-child>
              <button
                class="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                :disabled="resending === entry.id"
                @click="resend(entry)"
              >
                <RefreshCw :size="13" :class="resending === entry.id ? 'animate-spin' : ''" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Resend</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <button
                class="flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                @click="remove(entry)"
              >
                <Trash2 :size="13" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>

    <button
      v-if="logEntries.length >= PAGE_SIZE * (page + 1)"
      class="w-full py-2 text-xs text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-muted transition-colors"
      @click="loadMore()"
    >
      Load more
    </button>
  </div>
</template>
