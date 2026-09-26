<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ShieldAlert } from '@lucide/vue'
import type { PodcastDownloadCleanup, PodcastSummary } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import FormSheet from '@/components/FormSheet.vue'
import PodcastAcquisitionField from './PodcastAcquisitionField.vue'
import type { PodcastShowSettingsInput } from '../composables/usePodcastShowManagement'

const props = defineProps<{ open: boolean; show: PodcastSummary | null; busy: boolean }>()
const emit = defineEmits<{
  'update:open': [open: boolean]
  save: [input: PodcastShowSettingsInput]
  manage: []
}>()

const { t } = useI18n()
const policy = ref<PodcastShowSettingsInput['acquisitionPolicy']>('remote_only')
const limit = ref(3)
const windowDays = ref(30)
const downloadCleanup = ref<PodcastDownloadCleanup>('keep')
const cleanupDelayHours = ref(24)
const refreshMinutes = ref(60)
const isLocalShow = computed(() => props.show?.origin === 'local')
const cleanupDescription = computed(() =>
  downloadCleanup.value === 'after_finished' ? t('podcast.cleanup.afterFinishedDescription') : t('podcast.cleanup.keepDescription'),
)

function handleOpened() {
  const show = props.show
  if (!show) return
  policy.value = show.acquisitionPolicy === 'manual' ? 'remote_only' : show.acquisitionPolicy
  limit.value = show.autoDownloadLimit ?? 3
  windowDays.value = show.autoDownloadWindowDays ?? 30
  downloadCleanup.value = show.downloadCleanup
  cleanupDelayHours.value = show.downloadCleanupDelayHours
  refreshMinutes.value = show.refreshIntervalMinutes
}

function handleOpenUpdate(open: boolean) {
  emit('update:open', open)
}

function save() {
  emit('save', {
    acquisitionPolicy: policy.value,
    autoDownloadLimit: limit.value,
    autoDownloadWindowDays: windowDays.value,
    downloadCleanup: downloadCleanup.value,
    downloadCleanupDelayHours: cleanupDelayHours.value,
    refreshIntervalMinutes: refreshMinutes.value,
  })
}

function openManage() {
  emit('manage')
}
</script>

<template>
  <FormSheet
    :open="open && Boolean(show)"
    :title="t('podcast.library.settings')"
    :description="t('podcast.show.settingsDescription')"
    content-class="sm:max-w-md"
    :busy="busy"
    submit-test-id="podcast-save-settings"
    data-testid="podcast-settings-dialog"
    @update:open="handleOpenUpdate"
    @opened="handleOpened"
    @submit="save"
  >
    <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      <p v-if="isLocalShow" class="rounded-lg bg-muted/60 px-3 py-2 text-xs leading-5 text-muted-foreground">
        {{ t('podcast.show.localSettingsHint') }}
      </p>
      <PodcastAcquisitionField v-if="!isLocalShow" v-model:policy="policy" v-model:limit="limit" v-model:window-days="windowDays" />
      <fieldset class="mt-4">
        <legend class="block text-xs font-medium">{{ t('podcast.cleanup.title') }}</legend>
        <Select v-model="downloadCleanup" :aria-label="t('podcast.cleanup.title')" data-testid="podcast-download-cleanup" class="mt-2">
          <option value="keep">{{ t('podcast.cleanup.keep') }}</option>
          <option value="after_finished">{{ t('podcast.cleanup.afterFinished') }}</option>
        </Select>
        <p class="mt-2 text-xs leading-5 text-muted-foreground">{{ cleanupDescription }}</p>
        <label v-if="downloadCleanup === 'after_finished'" class="mt-3 block text-xs font-medium">
          {{ t('podcast.cleanup.delayHours') }}
          <Input v-model.number="cleanupDelayHours" type="number" min="0" max="8760" required data-testid="podcast-cleanup-delay" class="mt-1.5" />
        </label>
      </fieldset>
      <label v-if="!isLocalShow" class="mt-3 block text-xs font-medium">
        {{ t('podcast.show.refreshInterval') }}
        <Input v-model.number="refreshMinutes" type="number" min="5" max="10080" class="mt-1.5" />
      </label>
      <div class="mt-6 border-t border-border pt-4">
        <p class="text-xs leading-5 text-muted-foreground">{{ t('podcast.show.manageActionsDescription') }}</p>
        <Button
          variant="outline"
          class="mt-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
          data-testid="podcast-open-manage"
          @click="openManage"
        >
          <ShieldAlert :size="14" /> {{ t('podcast.show.openManageActions') }}
        </Button>
      </div>
    </div>
  </FormSheet>
</template>
