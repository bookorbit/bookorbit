<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowUpRight, TriangleAlert } from '@lucide/vue'
import { Permission } from '@bookorbit/types'
import { usePermissions } from '@/features/auth/composables/usePermissions'

/**
 * Said wherever a request is filed or waited on, because nothing else on those screens can say it:
 * a request with no source to search looks exactly like one waiting its turn.
 *
 * Shown to requesters as well as operators, with the fix swapped for who to ask. A requester
 * watching their own row sit at "pending" for a week is the person most owed the explanation, and
 * the one least able to find it.
 */
const props = defineProps<{
  /** True when no indexer row exists at all, rather than when every one of them is switched off. */
  nothingConfigured: boolean
}>()

const { t } = useI18n()
const { hasPermission } = usePermissions()

/** Settings > System > Requests is gated on managing settings, not on managing requests. */
const canFixSources = computed(() => hasPermission(Permission.ManageAppSettings))

const title = computed(() => t(props.nothingConfigured ? 'bookRequests.sources.noneConfigured' : 'bookRequests.sources.allDisabled'))
const message = computed(() => {
  if (!canFixSources.value) return t('bookRequests.sources.askAdmin')
  return t(props.nothingConfigured ? 'bookRequests.sources.noneConfiguredHint' : 'bookRequests.sources.allDisabledHint')
})
</script>

<template>
  <div role="status" class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-warning/40 bg-warning/10 px-3.5 py-3 text-sm">
    <TriangleAlert :size="16" class="shrink-0 text-warning" aria-hidden="true" />
    <p class="min-w-56 flex-1 text-foreground">
      <span class="font-medium">{{ title }}</span>
      <span class="text-muted-foreground"> {{ message }}</span>
    </p>
    <RouterLink
      v-if="canFixSources"
      :to="{ name: 'settings-admin-requests' }"
      class="inline-flex shrink-0 items-center gap-0.5 font-medium text-foreground underline-offset-2 hover:underline"
    >
      {{ t(props.nothingConfigured ? 'bookRequests.sources.addSource' : 'bookRequests.sources.reviewSources') }}
      <ArrowUpRight :size="14" aria-hidden="true" />
    </RouterLink>
  </div>
</template>
