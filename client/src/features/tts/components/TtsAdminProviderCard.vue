<script setup lang="ts">
import { computed } from 'vue'
import { AudioLines, Check, ChevronDown, ChevronUp, GripVertical, Loader2, Pencil, Trash2, X, Zap } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import TtsAdminVoiceChips from './TtsAdminVoiceChips.vue'
import type { TtsAdminHealth, TtsAdminProvider, TtsAdminVoice } from '../composables/useTtsAdminProviders'

const props = defineProps<{
  provider: TtsAdminProvider
  expanded: boolean
  health: TtsAdminHealth | undefined
  testing: boolean
  deleting: boolean
  playingVoiceKey: string | null
  previewLoadingKey: string | null
  canMoveUp: boolean
  canMoveDown: boolean
}>()

const emit = defineEmits<{
  toggleExpanded: []
  setEnabled: [enabled: boolean]
  test: []
  edit: []
  manageVoices: []
  remove: []
  preview: [voice: TtsAdminVoice]
  moveUp: []
  moveDown: []
}>()

const { t } = useI18n()

const monogram = computed(() => {
  const letters = props.provider.name.replace(/[^\p{L}\p{N} ]/gu, '').trim()
  if (!letters) return '?'
  const words = letters.split(/\s+/)
  return (words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : letters.slice(0, 2)).toUpperCase()
})

/**
 * One phrase, not three competing ones. A disabled provider says nothing about health: the dimmed
 * card and the off switch already carry that, and a stale "Ready" beside them reads as a conflict.
 */
const status = computed(() => {
  if (!props.provider.enabled) return null
  const state = props.health?.state ?? 'unknown'
  if (state === 'ok') return { tone: 'ok' as const, label: t('settings.admin.tts.statusConnected') }
  if (state === 'error') return { tone: 'error' as const, label: t('settings.admin.tts.statusUnreachable') }
  return { tone: 'idle' as const, label: t('settings.admin.tts.statusUnchecked') }
})

const voiceSummary = computed(() => t('settings.admin.tts.voiceCount', { count: props.provider.voices.length }))

const apiKeyLabel = computed(() => (props.provider.apiKey ? t('settings.admin.tts.apiKeySet') : t('settings.admin.tts.apiKeyNotSet')))

const discoveryLabel = computed(() =>
  props.provider.supportsVoiceDiscovery ? t('settings.admin.tts.discoverySupported') : t('settings.admin.tts.discoveryUnsupported'),
)

const testResultLabel = computed(() => {
  if (!props.health) return null
  if (props.health.state === 'ok') return t('settings.admin.tts.testPassed', { count: props.health.voiceCount ?? 0 })
  if (props.health.state === 'error') return props.health.message || t('settings.admin.tts.testFailed')
  return null
})

function handleToggleExpanded() {
  emit('toggleExpanded')
}

function handleSetEnabled(enabled: boolean) {
  emit('setEnabled', enabled)
}

function handleTest() {
  emit('test')
}

function handleEdit() {
  emit('edit')
}

function handleManageVoices() {
  emit('manageVoices')
}

function handleRemove() {
  emit('remove')
}

function handleMoveUp() {
  emit('moveUp')
}

function handleMoveDown() {
  emit('moveDown')
}

function handlePreview(voice: TtsAdminVoice) {
  emit('preview', voice)
}
</script>

<template>
  <article
    class="rounded-xl border border-border bg-card transition-opacity"
    :class="{ 'opacity-60': !provider.enabled }"
    :data-provider-key="provider.key"
  >
    <div class="flex items-center gap-3 p-4 sm:gap-4 sm:px-5">
      <div class="flex items-center self-stretch">
        <span
          class="tts-provider-drag-handle hidden cursor-grab text-muted-foreground transition-colors hover:text-foreground active:cursor-grabbing sm:block"
          aria-hidden="true"
        >
          <GripVertical class="size-4" />
        </span>
      </div>

      <span
        class="flex size-10 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
        :class="provider.enabled ? 'bg-primary/12 text-primary' : 'bg-muted text-muted-foreground'"
        aria-hidden="true"
      >
        {{ monogram }}
      </span>

      <div class="min-w-0 flex-1">
        <h3 class="truncate font-semibold text-foreground">{{ provider.name }}</h3>
        <p v-if="provider.baseUrl" class="mt-0.5 truncate font-mono text-xs text-muted-foreground">{{ provider.baseUrl }}</p>
      </div>

      <p class="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
        <span
          v-if="status"
          class="size-2 shrink-0 rounded-full"
          :class="{ 'bg-success': status.tone === 'ok', 'bg-destructive': status.tone === 'error', 'bg-muted-foreground/50': status.tone === 'idle' }"
          aria-hidden="true"
        />
        <span :class="status?.tone === 'error' ? 'text-destructive' : undefined">
          <template v-if="status">{{ status.label }} · </template>{{ voiceSummary }}
        </span>
      </p>

      <div class="flex shrink-0 items-center gap-1">
        <div class="flex flex-col sm:hidden">
          <button
            type="button"
            class="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
            :disabled="!canMoveUp"
            :aria-label="t('settings.admin.tts.moveUp', { name: provider.name })"
            @click="handleMoveUp"
          >
            <ChevronUp class="size-4" />
          </button>
          <button
            type="button"
            class="flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
            :disabled="!canMoveDown"
            :aria-label="t('settings.admin.tts.moveDown', { name: provider.name })"
            @click="handleMoveDown"
          >
            <ChevronDown class="size-4" />
          </button>
        </div>

        <ToggleSwitch
          :model-value="provider.enabled"
          :aria-label="t('settings.admin.tts.toggleEnabled', { name: provider.name })"
          @update:model-value="handleSetEnabled"
        />

        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="expanded ? t('settings.admin.tts.collapse', { name: provider.name }) : t('settings.admin.tts.expand', { name: provider.name })"
          :aria-expanded="expanded"
          @click="handleToggleExpanded"
        >
          <ChevronDown class="size-4 transition-transform" :class="{ 'rotate-180': expanded }" />
        </Button>
      </div>
    </div>

    <div v-if="expanded" class="border-t border-border px-4 py-5 sm:px-6">
      <div class="grid gap-8 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
        <section>
          <h4 class="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
            {{ t('settings.admin.tts.configuration') }}
          </h4>
          <dl class="mt-3.5 space-y-3 text-sm">
            <div class="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3">
              <dt class="text-xs text-muted-foreground">{{ t('settings.admin.tts.fieldType') }}</dt>
              <dd class="text-foreground">{{ t('settings.admin.tts.fieldTypeOpenAi') }}</dd>
            </div>
            <div class="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3">
              <dt class="text-xs text-muted-foreground">{{ t('settings.admin.tts.fieldApiKey') }}</dt>
              <dd class="text-foreground">{{ apiKeyLabel }}</dd>
            </div>
            <div class="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3">
              <dt class="text-xs text-muted-foreground">{{ t('settings.admin.tts.fieldModel') }}</dt>
              <dd class="truncate font-mono text-xs text-foreground">
                {{ provider.defaultModel || t('settings.admin.tts.fieldModelNone') }}
              </dd>
            </div>
            <div class="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3">
              <dt class="text-xs text-muted-foreground">{{ t('settings.admin.tts.fieldDiscovery') }}</dt>
              <dd class="flex items-center gap-1.5 text-foreground">
                <Check v-if="provider.supportsVoiceDiscovery" class="size-3.5 shrink-0 text-success" />
                <X v-else class="size-3.5 shrink-0 text-muted-foreground" />
                {{ discoveryLabel }}
              </dd>
            </div>
          </dl>
          <Button variant="outline" size="sm" class="mt-4" @click="handleEdit">
            <Pencil class="size-3.5" />
            {{ t('settings.admin.tts.editConfiguration') }}
          </Button>
        </section>

        <section class="min-w-0">
          <div class="mb-3.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <h4 class="text-[0.6875rem] font-semibold uppercase tracking-wider text-muted-foreground">
              {{ t('settings.admin.tts.voices') }}
            </h4>
            <p class="text-xs text-muted-foreground">
              {{ t('settings.admin.tts.voicesCurated', { count: provider.voices.length }) }}
              <template v-if="provider.voices.length > 0 && provider.enabled"> · {{ t('settings.admin.tts.voicesTapToPreview') }}</template>
            </p>
            <Button variant="outline" size="sm" class="ms-auto" @click="handleManageVoices">
              <AudioLines class="size-3.5" />
              {{ t('settings.admin.tts.manageVoices') }}
            </Button>
          </div>

          <TtsAdminVoiceChips
            v-if="provider.voices.length > 0"
            :voices="provider.voices"
            :provider-key="provider.key"
            :playing-voice-key="playingVoiceKey"
            :loading-voice-key="previewLoadingKey"
            :can-preview="provider.enabled"
            @preview="handlePreview"
          />
          <p v-else class="text-sm text-muted-foreground">{{ t('settings.admin.tts.voicesNone') }}</p>
        </section>
      </div>

      <div class="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-border pt-4">
        <Button variant="outline" size="sm" :disabled="testing" @click="handleTest">
          <Loader2 v-if="testing" class="size-3.5 animate-spin" />
          <Zap v-else class="size-3.5" />
          {{ t('settings.admin.tts.testConnection') }}
        </Button>
        <p v-if="testResultLabel" class="text-xs" :class="health?.state === 'error' ? 'text-destructive' : 'text-muted-foreground'" role="status">
          {{ testResultLabel }}
        </p>
        <Button
          variant="ghost"
          size="sm"
          class="ms-auto text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          :disabled="deleting"
          @click="handleRemove"
        >
          <Loader2 v-if="deleting" class="size-3.5 animate-spin" />
          <Trash2 v-else class="size-3.5" />
          {{ t('settings.admin.tts.delete') }}
        </Button>
      </div>
    </div>
  </article>
</template>
