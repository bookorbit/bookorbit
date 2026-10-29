<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Hammer } from '@lucide/vue'
import ExternalTextLink from '@/features/settings/components/ExternalTextLink.vue'

const REPOSITORY = 'https://github.com/bookorbit/bookorbit-metadata-providers'

const { t } = useI18n()

const LINKS = [
  { key: 'guide', href: 'https://github.com/bookorbit/bookorbit/blob/main/docs/BUILDING_METADATA_PROVIDERS.md' },
  { key: 'starters', href: `${REPOSITORY}/tree/main/starters` },
  { key: 'checker', href: `${REPOSITORY}/tree/main/conformance` },
  { key: 'suggest', href: `${REPOSITORY}/issues/new` },
] as const
</script>

<template>
  <section class="rounded-lg border border-dashed border-border px-4 py-3.5 md:px-5" aria-labelledby="build-your-own-title">
    <div class="flex items-start gap-3">
      <span class="grid size-8.5 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary" aria-hidden="true">
        <Hammer :size="16" />
      </span>
      <div class="min-w-0 space-y-1.5">
        <h3 id="build-your-own-title" class="text-sm font-semibold text-foreground">{{ t('settings.metadata.buildYourOwn.title') }}</h3>
        <p class="text-xs leading-relaxed text-muted-foreground">{{ t('settings.metadata.buildYourOwn.body') }}</p>
        <ul class="flex flex-wrap gap-x-4 gap-y-1.5 pt-0.5">
          <li v-for="link in LINKS" :key="link.key">
            <ExternalTextLink :href="link.href" :label="t(`settings.metadata.buildYourOwn.links.${link.key}`)" />
          </li>
        </ul>
      </div>
    </div>
  </section>
</template>
