<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Check, Copy, PackageOpen, Plus } from '@lucide/vue'
import { isMovedMetadataProviderKey, type MetadataProviderDirectoryEntry } from '@bookorbit/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { copyToClipboard } from '@/lib/clipboard'
import { formatLanguageName, formatList, formatRelativeTimeFromNow } from '@/i18n/formatters'
import ExternalTextLink from '@/features/settings/components/ExternalTextLink.vue'
import ProviderBrandTile from './ProviderBrandTile.vue'
import { composeAddressFor, composeServiceFor, useProviderDirectory } from '../composables/useProviderDirectory'

const props = defineProps<{
  /** Keys already registered, which show as added rather than offered again. */
  registeredKeys: string[]
}>()

const emit = defineEmits<{ add: [prefill: { baseUrl: string; allowPrivateAddress: boolean }] }>()

const { t } = useI18n()
const { directory, failed, fetchDirectory } = useProviderDirectory()

const registered = computed(() => new Set(props.registeredKeys))

const offered = computed(() => (directory.value?.providers ?? []).filter((entry) => !registered.value.has(entry.key)))
const addedNames = computed(() =>
  formatList((directory.value?.providers ?? []).filter((entry) => registered.value.has(entry.key)).map((entry) => entry.name)),
)

const sourceLine = computed(() => {
  const current = directory.value
  if (!current) return null
  if (current.source === 'remote' && current.fetchedAt) {
    return t('settings.metadata.providerDirectory.updated', { time: formatRelativeTimeFromNow(current.fetchedAt) })
  }
  return t('settings.metadata.providerDirectory.bundled')
})

function wasBuiltIn(entry: MetadataProviderDirectoryEntry): boolean {
  return isMovedMetadataProviderKey(entry.key)
}

function coverage(entry: MetadataProviderDirectoryEntry): string {
  return formatList([
    ...entry.mediaTypes.map((type) => t(`settings.metadata.providerDirectory.media.${type}`)),
    ...entry.languages.map((code) => formatLanguageName(code)),
  ])
}

function imageOf(entry: MetadataProviderDirectoryEntry): string {
  return `${entry.image}:${entry.version}`
}

async function handleCopy(entry: MetadataProviderDirectoryEntry) {
  if (await copyToClipboard(composeServiceFor(entry))) {
    toast.success(t('settings.metadata.providerDirectory.copied', { name: entry.name }))
  } else {
    toast.error(t('settings.metadata.providerDirectory.copyFailed'))
  }
}

function handleAdd(entry: MetadataProviderDirectoryEntry) {
  emit('add', { baseUrl: composeAddressFor(entry), allowPrivateAddress: true })
}

onMounted(() => {
  void fetchDirectory()
})
</script>

<template>
  <section class="@container overflow-hidden rounded-lg border border-border bg-card shadow-xs" aria-labelledby="provider-directory-title">
    <div class="flex flex-wrap items-center gap-2.5 border-b border-border bg-muted/40 px-4 py-2 md:px-5">
      <PackageOpen :size="13" class="shrink-0 text-muted-foreground" aria-hidden="true" />
      <h3 id="provider-directory-title" class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {{ t('settings.metadata.providerDirectory.title') }}
      </h3>
      <span v-if="sourceLine" class="ms-auto text-[11px] text-muted-foreground">{{ sourceLine }}</span>
    </div>

    <p class="border-b border-border px-4 py-2.5 text-xs leading-relaxed text-muted-foreground md:px-5">
      {{ t('settings.metadata.providerDirectory.hint') }}
    </p>

    <p v-if="failed" role="alert" class="px-4 py-6 text-center text-xs text-muted-foreground md:px-5">
      {{ t('settings.metadata.providerDirectory.loadFailed') }}
    </p>

    <template v-else-if="directory">
      <ul v-if="offered.length" class="grid gap-3 p-3 @2xl:grid-cols-2 @2xl:p-4">
        <li v-for="entry in offered" :key="entry.key" class="flex min-w-0 flex-col gap-2.5 rounded-lg border border-border bg-background/60 p-3.5">
          <div class="flex items-start gap-3">
            <ProviderBrandTile :provider-key="entry.key" :label="entry.name" :enabled="true" :color="entry.color" />
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h4 class="settings-label truncate">{{ entry.name }}</h4>
                <Badge
                  v-if="wasBuiltIn(entry)"
                  variant="outline"
                  class="h-5 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {{ t('settings.metadata.providerDirectory.wasBuiltIn') }}
                </Badge>
              </div>
              <p class="settings-hint truncate">{{ coverage(entry) }}</p>
            </div>
          </div>

          <p class="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{{ entry.summary }}</p>

          <code class="block truncate rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-foreground" :title="imageOf(entry)">{{
            imageOf(entry)
          }}</code>

          <div class="mt-auto flex flex-wrap items-center gap-2 pt-0.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              class="h-7 gap-1.5 px-2 text-[11px]"
              :aria-label="t('settings.metadata.providerDirectory.copyLabel', { name: entry.name })"
              @click="handleCopy(entry)"
            >
              <Copy :size="12" aria-hidden="true" />
              {{ t('settings.metadata.providerDirectory.copy') }}
            </Button>
            <Button
              type="button"
              size="sm"
              class="h-7 gap-1.5 px-2 text-[11px]"
              :aria-label="t('settings.metadata.providerDirectory.addLabel', { name: entry.name })"
              @click="handleAdd(entry)"
            >
              <Plus :size="12" aria-hidden="true" />
              {{ t('settings.metadata.providerDirectory.add') }}
            </Button>
            <ExternalTextLink
              class="ms-auto"
              :href="entry.docsUrl"
              :label="t('settings.metadata.providerDirectory.docs')"
              :aria-label="t('settings.metadata.providerDirectory.docsLabel', { name: entry.name })"
            />
          </div>
        </li>
      </ul>
      <p v-else class="px-4 py-6 text-center text-xs text-muted-foreground md:px-5">
        {{ t('settings.metadata.providerDirectory.allAdded') }}
      </p>
      <!-- They are listed in full just above, under Your providers. -->
      <p v-if="offered.length && addedNames.length" class="flex items-start gap-1.5 px-4 pb-3.5 text-xs text-muted-foreground md:px-5">
        <Check :size="13" class="mt-px shrink-0 text-success" aria-hidden="true" />
        <span>{{ t('settings.metadata.providerDirectory.alreadyAdded', { names: addedNames }) }}</span>
      </p>
    </template>
  </section>
</template>
