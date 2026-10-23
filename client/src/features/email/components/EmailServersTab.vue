<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Plus, Server } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import EmailServerRow from './EmailServerRow.vue'
import EmailTile from './EmailTile.vue'
import type { EmailProvider } from '../composables/useEmailProviders'

const props = defineProps<{
  providers: EmailProvider[]
  defaultProviderId: number | null
  canManage: boolean
  /** Who is looking: only the owner of a server may edit or test it. */
  userId: number | null
  /** Someone who may not send has no default to pick. */
  canPickDefault: boolean
  busy?: boolean
  testingId?: number | null
}>()

const emit = defineEmits<{ add: []; edit: [provider: EmailProvider]; makeDefault: [provider: EmailProvider]; test: [provider: EmailProvider] }>()

const { t } = useI18n()

function editable(provider: EmailProvider): boolean {
  return props.canManage && provider.userId === props.userId
}
function handleAdd() {
  emit('add')
}
function handleEdit(provider: EmailProvider) {
  emit('edit', provider)
}
function handleMakeDefault(provider: EmailProvider) {
  emit('makeDefault', provider)
}
function handleTest(provider: EmailProvider) {
  emit('test', provider)
}
</script>

<template>
  <section>
    <div class="mb-3 flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 sm:flex-nowrap">
      <h3 class="text-xs font-semibold tracking-[0.05em] whitespace-nowrap uppercase text-muted-foreground">{{ t('email.page.servers') }}</h3>
      <p
        v-if="providers.length > 0 && canPickDefault"
        class="order-3 min-w-0 basis-full text-[12.5px] text-muted-foreground sm:order-none sm:basis-auto"
      >
        {{ t('email.page.serversHint') }}
      </p>
      <Button v-if="canManage" size="sm" class="ms-auto h-7 gap-[5px] rounded-[7px] px-[9px] text-[13px] has-[>svg]:px-[9px]" @click="handleAdd">
        <Plus :size="14" aria-hidden="true" />{{ t('email.page.addServer') }}
      </Button>
    </div>

    <div v-if="providers.length === 0" class="settings-empty-state flex flex-col items-center gap-1.5 py-7">
      <EmailTile :icon="Server" :size="40" />
      <p class="text-sm font-semibold text-foreground">{{ t('email.page.serversEmptyTitle') }}</p>
      <p class="max-w-[440px] text-[12.5px] leading-[1.55] text-muted-foreground">
        {{ canManage ? t('email.page.serversEmptyBody') : t('email.page.noServersReadonly') }}
      </p>
      <Button v-if="canManage" size="sm" class="mt-2 h-7 gap-[5px] rounded-[7px] px-[9px] text-[13px] has-[>svg]:px-[9px]" @click="handleAdd">
        <Plus :size="14" aria-hidden="true" />{{ t('email.page.addServer') }}
      </Button>
    </div>

    <ul v-else class="settings-card">
      <li v-for="provider in providers" :key="provider.id">
        <EmailServerRow
          :provider="provider"
          :is-default="canPickDefault && provider.id === defaultProviderId"
          :editable="editable(provider)"
          :can-pick-default="canPickDefault"
          :busy="busy"
          :testing="testingId === provider.id"
          @edit="handleEdit"
          @make-default="handleMakeDefault"
          @test="handleTest"
        />
      </li>
    </ul>
  </section>
</template>
