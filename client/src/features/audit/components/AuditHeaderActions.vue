<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Braces, FileDown, FileText, History } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatDate } from '@/i18n/formatters'

const RETENTION_OPTIONS = [30, 90, 180, 365] as const

const props = defineProps<{ retentionDays: number | null; oldestAt: string | null; canEditRetention: boolean }>()
const emit = defineEmits<{ saveRetention: [days: number]; export: [format: 'csv' | 'json'] }>()
const { t } = useI18n()
const retentionOpen = ref(false)
const exportOpen = ref(false)

const oldest = computed(() => (props.oldestAt ? formatDate(new Date(props.oldestAt), { month: 'short', day: 'numeric', year: 'numeric' }) : null))

function chooseRetention(days: number) {
  if (!props.canEditRetention || days === props.retentionDays) return
  emit('saveRetention', days)
}

function exportCsv() {
  exportOpen.value = false
  emit('export', 'csv')
}

function exportJson() {
  exportOpen.value = false
  emit('export', 'json')
}
</script>

<template>
  <div class="flex items-center gap-2">
    <Popover v-if="retentionDays !== null" v-model:open="retentionOpen">
      <PopoverTrigger as-child>
        <Button variant="ghost" size="sm" type="button" class="text-muted-foreground hover:text-foreground max-md:size-8 max-md:px-0">
          <History :size="15" aria-hidden="true" />
          <span class="max-md:sr-only">{{ t('audit.retention.button', { count: retentionDays }) }}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" class="w-80 px-4 pt-3.5 pb-4">
        <p class="text-sm font-semibold text-foreground">{{ t('audit.retention.title') }}</p>
        <div
          role="group"
          :aria-label="t('audit.retention.title')"
          class="mt-2.5 grid grid-cols-4 gap-0.5 rounded-lg border border-border bg-muted p-0.5"
        >
          <button
            v-for="days in RETENTION_OPTIONS"
            :key="days"
            type="button"
            class="h-[30px] rounded-md text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
            :class="retentionDays === days ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground enabled:hover:text-foreground'"
            :aria-pressed="retentionDays === days"
            :disabled="!canEditRetention"
            @click="chooseRetention(days)"
          >
            {{ t('audit.retention.days', { count: days }) }}
          </button>
        </div>
        <p class="mt-2.5 text-[12.5px] leading-[18px] text-muted-foreground">
          {{ oldest ? t('audit.retention.hintWithOldest', { date: oldest }) : t('audit.retention.hint') }}
        </p>
        <p v-if="!canEditRetention" class="mt-1.5 text-[12.5px] leading-[18px] text-muted-foreground">{{ t('audit.retention.readOnly') }}</p>
      </PopoverContent>
    </Popover>

    <Popover v-model:open="exportOpen">
      <PopoverTrigger as-child>
        <Button variant="outline" size="sm" type="button" class="max-md:size-8 max-md:px-0">
          <FileDown :size="15" aria-hidden="true" />
          <span class="max-md:sr-only">{{ t('audit.export.button') }}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" class="w-80 px-4 pt-3.5 pb-4">
        <p class="text-sm font-semibold text-foreground">{{ t('audit.export.title') }}</p>
        <p class="mt-1.5 text-[12.5px] leading-[18px] text-muted-foreground">{{ t('audit.export.hint') }}</p>
        <div class="mt-3 flex gap-2">
          <Button variant="outline" size="sm" type="button" @click="exportCsv">
            <FileText :size="14" aria-hidden="true" />
            {{ t('audit.export.csv') }}
          </Button>
          <Button variant="outline" size="sm" type="button" @click="exportJson">
            <Braces :size="14" aria-hidden="true" />
            {{ t('audit.export.json') }}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  </div>
</template>
