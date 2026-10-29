<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { TriangleAlert } from '@lucide/vue'
import type { ProviderStatus } from '@bookorbit/types'

const props = defineProps<{ statuses: ProviderStatus[] }>()

const { t } = useI18n()

type MovedStatus = ProviderStatus & { movedOut: NonNullable<ProviderStatus['movedOut']> }

/** Only the ones something still relies on: an unused source that moved out needs no word. */
const pending = computed(() => props.statuses.filter((status): status is MovedStatus => status.movedOut?.inUse === true))
</script>

<template>
  <section
    v-if="pending.length"
    role="status"
    class="rounded-lg border border-warning/30 bg-warning/8 px-4 py-3 md:px-5"
    aria-labelledby="moved-providers-title"
  >
    <div class="flex items-start gap-2.5">
      <TriangleAlert :size="15" class="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
      <div class="min-w-0 space-y-2 text-xs text-foreground">
        <h3 id="moved-providers-title" class="text-sm font-semibold">{{ t('settings.metadata.movedProviders.title') }}</h3>
        <p class="leading-relaxed text-muted-foreground">{{ t('settings.metadata.movedProviders.description') }}</p>
        <ul class="space-y-1.5">
          <li v-for="provider in pending" :key="provider.key" class="space-y-0.5 leading-relaxed">
            <i18n-t v-if="provider.movedOut.image" keypath="settings.metadata.movedProviders.run" tag="p" scope="global">
              <template #name>
                <span class="font-semibold">{{ provider.label }}</span>
              </template>
              <template #image>
                <code class="break-all rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{{ provider.movedOut.image }}</code>
              </template>
            </i18n-t>
            <i18n-t v-else keypath="settings.metadata.movedProviders.closed" tag="p" scope="global">
              <template #name>
                <span class="font-semibold">{{ provider.label }}</span>
              </template>
            </i18n-t>
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
