<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Plug, Plus, Search, Server, ServerCog, Upload } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import PluginDirectoryLink from './PluginDirectoryLink.vue'
import SettingsEmptyPanel from './SettingsEmptyPanel.vue'

/**
 * The Sources tab with nothing on it at all.
 *
 * There are exactly two ways in, and they are the two groups this replaces, so they are offered at
 * the same size as each other with each button beside the sentence that justifies it. That is the
 * whole reason this is not the plain one-action panel the other groups use.
 */
const props = defineProps<{
  /** False for anyone who is not an administrator, who is left with the one door they can open. */
  canInstallPlugins: boolean
}>()

const emit = defineEmits<{
  installPlugin: []
  addIndexer: []
  addManager: []
}>()

const { t } = useI18n()

function handleInstallPlugin() {
  emit('installPlugin')
}

function handleAddIndexer() {
  emit('addIndexer')
}

function handleAddManager() {
  emit('addManager')
}
</script>

<template>
  <SettingsEmptyPanel
    :title="t('settings.system.requests.indexers.empty.title')"
    :body="t('settings.system.requests.indexers.empty.body')"
    :note="t('settings.system.requests.indexers.empty.responsibility')"
  >
    <template #icon>
      <Search :size="18" />
    </template>

    <div class="grid gap-3" :class="props.canInstallPlugins ? 'sm:grid-cols-3' : 'sm:grid-cols-2'">
      <div class="flex flex-col rounded-lg border border-primary/45 bg-primary/6 p-4 shadow-xs">
        <div class="flex flex-wrap items-center gap-2 text-muted-foreground">
          <ServerCog :size="15" aria-hidden="true" />
          <h3 class="text-sm font-medium text-foreground">
            {{ t('settings.system.requests.indexers.empty.prowlarrTitle') }}
          </h3>
          <span class="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-primary">
            {{ t('settings.system.requests.indexers.empty.recommended') }}
          </span>
        </div>
        <p class="mt-1.5 flex-1 text-xs leading-relaxed text-muted-foreground">
          {{ t('settings.system.requests.indexers.empty.prowlarrBody') }}
        </p>
        <div class="mt-3.5">
          <Button size="sm" @click="handleAddManager">
            <Plus :size="15" aria-hidden="true" />
            {{ t('settings.system.requests.managers.add') }}
          </Button>
        </div>
      </div>

      <!-- Not offered to anyone who cannot install one: a plugin runs its code in the server. -->
      <div v-if="props.canInstallPlugins" class="flex flex-col rounded-lg border border-border bg-card p-4 shadow-xs">
        <div class="flex items-center gap-2 text-muted-foreground">
          <Plug :size="15" aria-hidden="true" />
          <h3 class="text-sm font-medium text-foreground">
            {{ t('settings.system.requests.indexers.empty.pluginTitle') }}
          </h3>
        </div>
        <p class="mt-1.5 flex-1 text-xs leading-relaxed text-muted-foreground">
          {{ t('settings.system.requests.indexers.empty.pluginBody') }}
          <PluginDirectoryLink />
        </p>
        <div class="mt-3.5">
          <Button size="sm" @click="handleInstallPlugin">
            <Upload :size="15" aria-hidden="true" />
            {{ t('settings.system.requests.indexers.plugins.install') }}
          </Button>
        </div>
      </div>

      <div class="flex flex-col rounded-lg border border-border bg-card p-4 shadow-xs">
        <div class="flex items-center gap-2 text-muted-foreground">
          <Server :size="15" aria-hidden="true" />
          <h3 class="text-sm font-medium text-foreground">
            {{ t('settings.system.requests.indexers.empty.builtInTitle') }}
          </h3>
        </div>
        <p class="mt-1.5 flex-1 text-xs leading-relaxed text-muted-foreground">
          {{ t('settings.system.requests.indexers.empty.builtInBody') }}
        </p>
        <div class="mt-3.5">
          <Button size="sm" @click="handleAddIndexer">
            <Plus :size="15" aria-hidden="true" />
            {{ t('settings.system.requests.indexers.add') }}
          </Button>
        </div>
      </div>
    </div>
  </SettingsEmptyPanel>
</template>
