<script setup lang="ts">
import { toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { Upload } from '@lucide/vue'
import type { PodcastOpmlImportResult } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import FormSheet from '@/components/FormSheet.vue'
import { useFilePicker } from '@/composables/useFilePicker'
import PodcastAcquisitionField from './PodcastAcquisitionField.vue'
import { usePodcastOpmlTransfer } from '../composables/usePodcastOpmlTransfer'

const props = defineProps<{ open: boolean; libraryId: number }>()
const emit = defineEmits<{
  'update:open': [open: boolean]
  imported: [result: PodcastOpmlImportResult]
}>()

const { t } = useI18n()
const transfer = usePodcastOpmlTransfer(toRef(props, 'libraryId'))
const { importFile, importPolicy, importLimit, importWindowDays, importing } = transfer
const { input: fileInput, open: chooseFile, handleChange: handleFileSelected } = useFilePicker(transfer.selectImportFile)

function handleOpened() {
  transfer.resetImport()
}

function handleOpenUpdate(open: boolean) {
  emit('update:open', open)
}

function close() {
  emit('update:open', false)
}

async function handleImport() {
  const result = await transfer.importOpml()
  if (!result) return
  close()
  emit('imported', result)
}
</script>

<template>
  <FormSheet
    :open="open"
    :title="t('podcast.library.importOpml')"
    :description="t('podcast.library.importOpmlDescription')"
    content-class="sm:max-w-lg"
    :busy="importing"
    :submit-label="t('podcast.library.import')"
    :submit-disabled="!importFile"
    data-testid="podcast-import-sheet"
    @update:open="handleOpenUpdate"
    @opened="handleOpened"
    @submit="handleImport"
  >
    <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      <p id="podcast-import-file-label" class="block text-xs font-medium">{{ t('podcast.library.opmlFile') }}</p>
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="outline" aria-describedby="podcast-import-file-label" @click="chooseFile">
          <Upload :size="14" /> {{ t('podcast.library.chooseOpmlFile') }}
        </Button>
        <span class="min-w-0 truncate text-xs text-muted-foreground" data-testid="podcast-import-filename">
          {{ importFile ? importFile.name : t('podcast.library.noOpmlFileChosen') }}
        </span>
      </div>
      <input ref="fileInput" type="file" accept=".opml,.xml,text/xml" class="hidden" @change="handleFileSelected" />
      <PodcastAcquisitionField v-model:policy="importPolicy" v-model:limit="importLimit" v-model:window-days="importWindowDays" class="mt-5" />
      <p class="mt-2 text-xs leading-5 text-muted-foreground">{{ t('podcast.library.importPolicyHint') }}</p>
    </div>
  </FormSheet>
</template>
