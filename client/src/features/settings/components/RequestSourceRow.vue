<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, Pencil, Plug, Server, Trash2, TriangleAlert, Upload } from '@lucide/vue'
import type { IndexerItem } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import ConnectionHealth from '../ConnectionHealth.vue'
import SearchHealth from '../SearchHealth.vue'
import { sourceDotClass } from '@/features/book-requests/sourceColors'
import PluginVersionBadge from './PluginVersionBadge.vue'

/**
 * One configured source. The same row in both groups on the Requests page: a plugin and a Torznab
 * endpoint are added in different ways but are the same thing once they exist, and rendering them
 * differently would say they are not.
 */
const props = defineProps<{
  indexer: IndexerItem
  testing: boolean
  /** False once a plugin behind a row is gone, which the row has to explain rather than hide. */
  available: boolean
  plugin?: boolean
  /** The installed plugin release. Missing for legacy plugins that predate this metadata. */
  pluginVersion?: string
  /** True while this row's enabled flag is in flight, so the switch cannot be double-flipped. */
  busy?: boolean
  /**
   * Whether the plugin behind this row can be updated or removed here. Off for a Torznab row,
   * which is compiled in, and for anyone who is not an administrator.
   */
  managePlugin?: boolean
  /** True while this plugin's removal is in flight, so its own two controls go inert. */
  pluginBusy?: boolean
}>()

const emit = defineEmits<{ test: []; edit: []; toggle: [enabled: boolean]; updatePlugin: []; removePlugin: [] }>()

const { t } = useI18n()

const failing = computed(() => props.indexer.enabled && props.indexer.lastTestOk === false)
/** Mirrors `SearchHealth`'s own rule, so the sentence below only appears under the badge. */
const searchFailing = computed(() => props.indexer.enabled && props.indexer.lastSearchOk === false && props.indexer.searchFailureStreak > 0)

function handleToggle(enabled: boolean) {
  emit('toggle', enabled)
}

function handleTest() {
  emit('test')
}

function handleEdit() {
  emit('edit')
}

function handleUpdatePlugin() {
  emit('updatePlugin')
}

function handleRemovePlugin() {
  emit('removePlugin')
}
</script>

<template>
  <div class="bg-card px-4 py-3.5 md:px-5 md:py-4" :class="failing ? 'rounded-[inherit] ring-1 ring-destructive/40' : ''">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="flex min-w-0 flex-1 basis-72 gap-3">
        <span
          class="flex size-8 shrink-0 items-center justify-center rounded-lg"
          :class="failing ? 'bg-destructive/12 text-destructive' : 'bg-muted text-muted-foreground'"
          aria-hidden="true"
        >
          <TriangleAlert v-if="failing" :size="17" />
          <Plug v-else-if="plugin" :size="17" />
          <Server v-else :size="17" />
        </span>

        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <!-- The assignment shown where it is made. A dot rather than a coloured name: the
                 colour is this source's mark in the release picker, not a property of its title,
                 and tinted text here would fail the contrast the tokens are tuned for. -->
            <span
              v-if="indexer.color"
              class="size-2 shrink-0 rounded-full"
              :class="sourceDotClass(indexer.color)"
              :aria-label="t(`settings.system.requests.indexers.color.options.${indexer.color}`)"
              role="img"
            ></span>
            <p class="settings-label">{{ indexer.name }}</p>
            <PluginVersionBadge v-if="plugin" :version="pluginVersion" />
            <ConnectionHealth :last-tested-at="indexer.lastTestedAt" :last-test-ok="indexer.lastTestOk" :enabled="indexer.enabled" />
            <!-- Beside it rather than instead of it: "reachable" and "answering searches" are two
                 different facts about a source, and a tracker can be the first without the second. -->
            <SearchHealth
              :last-search-at="indexer.lastSearchAt"
              :last-search-ok="indexer.lastSearchOk"
              :search-failure-streak="indexer.searchFailureStreak"
              :enabled="indexer.enabled"
            />
          </div>

          <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span class="font-mono break-all">{{ indexer.baseUrl }}</span>
          </div>

          <p v-if="!available" role="status" class="mt-1.5 text-xs text-destructive">
            {{ t('settings.system.requests.indexers.unavailable', { type: indexer.adapterType }) }}
          </p>
          <p v-if="failing && indexer.lastErrorMessage" class="mt-1.5 text-xs text-destructive">{{ indexer.lastErrorMessage }}</p>
          <p v-if="searchFailing && indexer.lastSearchError" class="mt-1.5 text-xs text-foreground">{{ indexer.lastSearchError }}</p>
        </div>
      </div>

      <div class="flex shrink-0 items-center gap-1.5">
        <!--
          Turning a source off is the ordinary thing to do with one that is noisy, rate limited or
          temporarily broken, and it is reversible. Reaching it through the editor put it behind the
          same door as changing a credential, so it lives on the row and the badge beside the name
          already reads "Disabled" once it is flipped.
        -->
        <ToggleSwitch
          class="me-1.5"
          :model-value="indexer.enabled"
          :disabled="busy"
          :aria-label="t('settings.system.requests.indexers.toggleAria', { name: indexer.name })"
          @update:model-value="handleToggle"
        />
        <TooltipProvider :delay-duration="0">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                size="icon-sm"
                variant="outline"
                :disabled="testing"
                :aria-label="t('settings.system.requests.indexers.test')"
                @click="handleTest"
              >
                <Loader2 v-if="testing" class="animate-spin" aria-hidden="true" />
                <Plug v-else :size="15" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ t('settings.system.requests.indexers.test') }}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                size="icon-sm"
                variant="outline"
                :aria-label="t('settings.system.requests.indexers.editName', { name: indexer.name })"
                @click="handleEdit"
              >
                <Pencil :size="15" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ t('settings.system.requests.indexers.editName', { name: indexer.name }) }}</TooltipContent>
          </Tooltip>

          <!--
            The plugin behind the row, not the row. It is installed once and every source of its
            type runs it, so it is kept apart from this source's own controls by a divider and
            says which of the two it acts on.
          -->
          <template v-if="managePlugin">
            <span class="mx-0.5 h-5 w-px bg-border" aria-hidden="true"></span>
            <Tooltip v-if="available">
              <TooltipTrigger as-child>
                <Button
                  size="icon-sm"
                  variant="outline"
                  :disabled="pluginBusy"
                  :aria-label="t('settings.system.requests.indexers.plugins.update')"
                  @click="handleUpdatePlugin"
                >
                  <Upload :size="15" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{{ t('settings.system.requests.indexers.plugins.update') }}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  size="icon-sm"
                  variant="destructive-outline"
                  :disabled="pluginBusy"
                  :aria-label="t('settings.system.requests.indexers.plugins.removeAction')"
                  @click="handleRemovePlugin"
                >
                  <Loader2 v-if="pluginBusy" class="animate-spin" aria-hidden="true" />
                  <Trash2 v-else :size="15" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{{ t('settings.system.requests.indexers.plugins.removeAction') }}</TooltipContent>
            </Tooltip>
          </template>
        </TooltipProvider>
      </div>
    </div>
  </div>
</template>
