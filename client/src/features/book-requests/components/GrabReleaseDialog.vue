<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { MAX_TORRENT_FILE_BYTES } from '@bookorbit/types'
import type { BookRequestItem, DownloadClientSummary, GrabBookRequestPayload } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { formatBytes } from '@/lib/formatting'

const props = defineProps<{
  request: BookRequestItem | null
  clients: DownloadClientSummary[]
  busy: boolean
}>()

const emit = defineEmits<{
  close: []
  grab: [payload: { request: BookRequestItem; body: GrabBookRequestPayload }]
}>()

const { t } = useI18n()

const magnet = ref('')
const torrentFileBase64 = ref('')
const torrentFileName = ref('')
const downloadClientId = ref<number | null>(null)

const isOpen = computed(() => props.request !== null)
const canSubmit = computed(() => Boolean(magnet.value.trim()) !== Boolean(torrentFileBase64.value))

watch(
  () => props.request?.id,
  () => {
    magnet.value = ''
    torrentFileBase64.value = ''
    torrentFileName.value = ''
    downloadClientId.value = props.clients[0]?.id ?? null
  },
)

function handleOpenChange(open: boolean) {
  if (!open && !props.busy) emit('close')
}

function handleClose() {
  emit('close')
}

/**
 * Read as base64 so the grab stays one JSON endpoint; .torrent files are only a few kilobytes.
 *
 * Bounded first, and by the same limit the server enforces: whatever the picker was pointed at,
 * this is a plain file input, and a video dropped into it used to be read whole into a string one
 * character at a time before anything looked at its size.
 */
async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  torrentFileBase64.value = ''
  torrentFileName.value = ''
  if (!file) return

  if (file.size > MAX_TORRENT_FILE_BYTES) {
    input.value = ''
    toast.error(t('bookRequests.grab.errors.fileTooLarge', { limit: formatBytes(MAX_TORRENT_FILE_BYTES) }))
    return
  }

  try {
    torrentFileBase64.value = await readAsBase64(file)
  } catch {
    input.value = ''
    toast.error(t('bookRequests.grab.errors.fileUnreadable'))
    return
  }
  torrentFileName.value = file.name
  magnet.value = ''
}

/**
 * `FileReader` hands back a data URL the browser encoded natively; the alternative is building the
 * binary string in script, which is a character of garbage collection per byte of file.
 */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('unreadable'))
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      if (comma === -1) reject(new Error('unreadable'))
      else resolve(result.slice(comma + 1))
    }
    reader.readAsDataURL(file)
  })
}

function handleSubmit() {
  if (!props.request) return
  if (!canSubmit.value) {
    toast.error(t('bookRequests.grab.errors.pickOne'))
    return
  }

  emit('grab', {
    request: props.request,
    body: {
      ...(magnet.value.trim() ? { magnet: magnet.value.trim() } : {}),
      ...(torrentFileBase64.value ? { torrentFileBase64: torrentFileBase64.value, torrentFileName: torrentFileName.value } : {}),
      ...(downloadClientId.value !== null ? { downloadClientId: downloadClientId.value } : {}),
    },
  })
}
</script>

<template>
  <DialogRoot :open="isOpen" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-foreground/50" />
      <DialogContent
        aria-modal="true"
        class="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <DialogTitle class="text-lg font-semibold text-foreground">{{ t('bookRequests.grab.title') }}</DialogTitle>
        <DialogDescription class="mt-1 text-sm text-muted-foreground">
          {{ t('bookRequests.grab.subtitle', { title: request?.title ?? '' }) }}
        </DialogDescription>
        <p class="mt-2 text-xs text-muted-foreground">{{ t('bookRequests.grab.singleFileNote') }}</p>

        <div class="mt-4 space-y-3">
          <div>
            <label for="grab-magnet" class="settings-label">{{ t('bookRequests.grab.magnet') }}</label>
            <input id="grab-magnet" v-model="magnet" type="text" class="settings-input" placeholder="magnet:?xt=urn:btih:..." />
          </div>

          <div>
            <label for="grab-torrent-file" class="settings-label">{{ t('bookRequests.grab.torrentFile') }}</label>
            <input
              id="grab-torrent-file"
              type="file"
              accept=".torrent,application/x-bittorrent"
              class="settings-input pt-1.5"
              @change="handleFileChange"
            />
            <p v-if="torrentFileName" class="settings-hint">{{ torrentFileName }}</p>
          </div>

          <div v-if="clients.length > 1">
            <label for="grab-client" class="settings-label">{{ t('bookRequests.grab.client') }}</label>
            <select id="grab-client" v-model="downloadClientId" class="settings-input">
              <option v-for="client in clients" :key="client.id" :value="client.id">{{ client.name }}</option>
            </select>
          </div>

          <!--
            An empty list is not a reason to block the send: the server picks its highest-priority
            enabled client when none is named, and it answers with a usable message when there is
            none at all. Blocking here used to lock out an approver who simply cannot read the list.
          -->
          <p v-if="clients.length === 0" role="status" class="settings-hint">{{ t('bookRequests.grab.noClientList') }}</p>
        </div>

        <div class="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" :disabled="busy" @click="handleClose">{{ t('common.cancel') }}</Button>
          <Button size="sm" :disabled="busy" @click="handleSubmit">{{ t('bookRequests.grab.submit') }}</Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
