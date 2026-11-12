<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Loader2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import type { StoryGuideDeleteAllRequest, StoryGuidesSummary } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { errorMessage } from '@/lib/api-json'
import { formatBytes } from '@/lib/formatting'
import * as aiApi from '../api/ai.api'

const emit = defineEmits<{ deleted: [] }>()

const { t } = useI18n()

const summary = ref<StoryGuidesSummary | null>(null)
const loading = ref(true)
const failed = ref(false)

/** Asking twice: first what goes, then the count typed back. */
const step = ref<'idle' | 'confirm' | 'type'>('idle')
const deleting = ref(false)
/** Fixes made for everyone outlive their guide unless deleting them is chosen; keeping is the default. */
const fixes = ref<StoryGuideDeleteAllRequest['fixes']>('keep')
const fixCount = computed(() => summary.value?.fixes ?? 0)

async function load() {
  loading.value = true
  failed.value = false
  try {
    summary.value = await aiApi.getStoryGuidesSummary()
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
}

onMounted(load)

function startDelete() {
  fixes.value = 'keep'
  step.value = 'confirm'
}

function chooseKeepFixes() {
  fixes.value = 'keep'
}

function chooseDeleteFixes() {
  fixes.value = 'delete'
}

async function handleDelete() {
  const count = summary.value?.count
  if (count === undefined) return
  deleting.value = true
  try {
    const result = await aiApi.deleteAllStoryGuides({ fixes: fixCount.value > 0 ? fixes.value : 'keep', count })
    if (result.kind === 'count-changed') {
      toast.error(t('settings.admin.ai.features.storyGuides.countChanged'))
    } else {
      toast.success(t('settings.admin.ai.features.storyGuides.deleted', { count: result.deleted }))
      emit('deleted')
    }
    step.value = 'idle'
    await load()
  } catch (reason) {
    toast.error(errorMessage(reason, 'settings.admin.ai.features.storyGuides.deleteFailed'))
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4" data-testid="ai-story-guides-data">
    <div v-if="loading" class="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 class="size-3.5 animate-spin" aria-hidden="true" />
      <span>{{ t('settings.admin.ai.features.storyGuides.loading') }}</span>
    </div>
    <p v-else-if="failed || !summary" class="text-xs text-muted-foreground">
      {{ t('settings.admin.ai.features.storyGuides.loadFailed') }}
      <button
        type="button"
        class="text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        @click="load"
      >
        {{ t('common.retry') }}
      </button>
    </p>
    <p v-else class="text-xs text-muted-foreground tabular-nums" data-testid="ai-story-guides-count">
      {{ t('settings.admin.ai.features.storyGuides.data', { count: summary.count, size: formatBytes(summary.bytes) }) }}
    </p>
    <Button
      v-if="summary && summary.count > 0"
      variant="outline"
      size="sm"
      class="text-destructive"
      data-testid="ai-story-guides-delete"
      @click="startDelete"
    >
      {{ t('settings.admin.ai.features.storyGuides.deleteAll') }}
    </Button>

    <ConfirmDialog
      :open="step === 'confirm'"
      :title="t('settings.admin.ai.features.storyGuides.deleteTitle')"
      :description="t('settings.admin.ai.features.storyGuides.deleteBody', { count: summary?.count ?? 0 })"
      :confirm-label="t('settings.admin.ai.features.storyGuides.continue')"
      @confirm="step = 'type'"
      @cancel="step = 'idle'"
    >
      <fieldset v-if="fixCount > 0" class="mt-4 space-y-2.5" data-testid="ai-story-guides-fixes">
        <legend class="text-xs font-medium text-foreground">
          {{ t('settings.admin.ai.features.storyGuides.fixesQuestion', { count: fixCount }) }}
        </legend>
        <label class="flex items-start gap-2.5">
          <input
            type="radio"
            name="story-guide-fixes"
            class="mt-0.5 accent-primary"
            value="keep"
            :checked="fixes === 'keep'"
            @change="chooseKeepFixes"
          />
          <span class="min-w-0">
            <span class="block text-sm text-foreground">{{ t('settings.admin.ai.features.storyGuides.keepFixes') }}</span>
            <span class="block text-xs text-muted-foreground">{{ t('settings.admin.ai.features.storyGuides.keepFixesBrief') }}</span>
          </span>
        </label>
        <label class="flex items-start gap-2.5">
          <input
            type="radio"
            name="story-guide-fixes"
            class="mt-0.5 accent-primary"
            value="delete"
            :checked="fixes === 'delete'"
            @change="chooseDeleteFixes"
          />
          <span class="block min-w-0 text-sm text-foreground">{{ t('settings.admin.ai.features.storyGuides.deleteFixes') }}</span>
        </label>
      </fieldset>
    </ConfirmDialog>
    <ConfirmDialog
      :open="step === 'type'"
      :title="t('settings.admin.ai.features.storyGuides.typeTitle')"
      :description="t('settings.admin.ai.features.storyGuides.typeBody')"
      :confirm-label="t('settings.admin.ai.features.storyGuides.delete')"
      :confirmation-phrase="String(summary?.count ?? 0)"
      :busy="deleting"
      @confirm="handleDelete"
      @cancel="step = 'idle'"
    />
  </div>
</template>
