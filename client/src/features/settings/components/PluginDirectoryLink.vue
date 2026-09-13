<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ExternalLink } from '@lucide/vue'

/**
 * The way out to the plugin collection, sized as a link rather than as a card.
 *
 * It belongs inside the sentence that explains what a plugin is, in the group hint and in the empty
 * panel alike. Given its own bordered card it read at the weight of a configured source, and above
 * both group headings it belonged to neither.
 */
const OPEN_PLUGIN_DIRECTORY_URL = 'https://github.com/orbit-plugins/bookorbit-open-plugins'

const { t } = useI18n()
</script>

<template>
  <a
    :href="OPEN_PLUGIN_DIRECTORY_URL"
    target="_blank"
    rel="noopener noreferrer"
    class="inline-flex items-center gap-1 rounded-sm align-baseline text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
  >
    <span class="underline underline-offset-2">{{ t('settings.system.requests.indexers.plugins.directoryLink') }}</span>
    <ExternalLink :size="12" class="shrink-0" aria-hidden="true" />
  </a>
</template>
