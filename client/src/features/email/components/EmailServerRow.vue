<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, Pencil, PlugZap, Server, X } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import { formatRelativeFromNow } from '@/i18n/formatters'
import EmailStarButton from './EmailStarButton.vue'
import EmailTile from './EmailTile.vue'
import type { EmailProvider } from '../composables/useEmailProviders'

const props = withDefaults(
  defineProps<{
    provider: EmailProvider
    isDefault: boolean
    /** Only the owner, with the permission to manage email, opens the editor or runs a test. */
    editable: boolean
    /** Someone who may manage servers but not send has no default to pick. */
    canPickDefault?: boolean
    busy?: boolean
    testing?: boolean
  }>(),
  { canPickDefault: true, busy: false, testing: false },
)
const emit = defineEmits<{ edit: [provider: EmailProvider]; makeDefault: [provider: EmailProvider]; test: [provider: EmailProvider] }>()

const { t } = useI18n()

const failing = computed(() => props.provider.lastTestOk === false)
const security = computed(() => {
  if (props.provider.ssl) return t('email.editor.server.securitySsl')
  return props.provider.startTls ? t('email.editor.server.securityStarttls') : t('email.page.noEncryption')
})
const roles = computed(() => {
  const out: string[] = []
  if (props.provider.isShared) out.push(t('email.page.roleShared'))
  if (props.provider.isSystemProvider) out.push(t('email.page.roleSystem'))
  return out
})
const testedAgo = computed(() =>
  props.provider.lastTestedAt ? t('email.attention.testedAgo', { time: formatRelativeFromNow(new Date(props.provider.lastTestedAt)) }) : '',
)

function handleEdit() {
  if (props.editable) emit('edit', props.provider)
}
function handleStar() {
  emit('makeDefault', props.provider)
}
function handleTest() {
  emit('test', props.provider)
}
</script>

<template>
  <div
    class="group/row relative flex min-h-16 flex-wrap items-start gap-x-3.5 px-3.5 py-3 transition-colors sm:flex-nowrap sm:px-4"
    :class="editable ? 'hover:bg-foreground/[0.025]' : ''"
  >
    <button
      v-if="editable"
      type="button"
      class="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      :aria-label="t('email.page.editServer', { name: provider.name })"
      @click="handleEdit"
    />
    <EmailTile :icon="Server" :size="36" class="pointer-events-none" />
    <div class="pointer-events-none min-w-0 flex-1 basis-[calc(100%-3.125rem)] sm:basis-auto">
      <p class="flex min-w-0 items-center gap-2 text-sm leading-[1.45] font-medium text-foreground">
        <span class="truncate">{{ provider.name }}</span>
        <span
          v-if="failing"
          class="inline-flex shrink-0 items-center gap-[5px] rounded-full border border-destructive/32 bg-destructive/12 px-2 py-px text-[11.5px] leading-[18px] font-semibold whitespace-nowrap text-destructive"
        >
          <X :size="12" aria-hidden="true" />{{ t('email.page.cantConnect') }}
        </span>
      </p>
      <p
        class="mt-[3px] flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-[1.45] text-muted-foreground sm:flex-nowrap sm:overflow-hidden sm:whitespace-nowrap"
      >
        <span class="font-mono text-path-dim" dir="ltr">{{ provider.host }}:{{ provider.port }}</span>
        <span aria-hidden="true">·</span>
        <span>{{ security }}</span>
        <template v-if="provider.fromAddress">
          <span class="hidden sm:inline" aria-hidden="true">·</span>
          <span class="basis-full truncate font-mono text-path-dim sm:basis-auto" dir="ltr">{{ provider.fromAddress }}</span>
        </template>
      </p>
      <p v-if="failing" class="mt-[3px] flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs leading-[1.45] text-muted-foreground">
        <span v-if="provider.lastTestError" class="font-mono text-[11.5px] [overflow-wrap:anywhere] text-destructive" dir="ltr">{{
          provider.lastTestError
        }}</span>
        <span v-if="provider.lastTestError && testedAgo" aria-hidden="true">·</span>
        <span v-if="testedAgo">{{ testedAgo }}</span>
      </p>
      <p v-if="roles.length" class="mt-[3px] truncate text-xs leading-[1.45] text-muted-foreground">{{ roles.join(' · ') }}</p>
    </div>
    <!-- On a phone the actions take their own line under the text, so the name keeps its width. -->
    <div class="ms-[50px] mt-2 flex shrink-0 items-center gap-1 sm:ms-4 sm:mt-0">
      <Button
        v-if="editable"
        variant="outline"
        size="sm"
        class="relative z-10 h-7 gap-[5px] rounded-[7px] px-[9px] text-[13px] has-[>svg]:px-[9px]"
        :disabled="testing"
        :aria-label="t('email.page.testServer', { name: provider.name })"
        @click="handleTest"
      >
        <Loader2 v-if="testing" :size="14" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <PlugZap v-else :size="14" aria-hidden="true" />
        {{ t('email.page.test') }}
      </Button>
      <EmailStarButton
        v-if="canPickDefault"
        :on="isDefault"
        :busy="busy"
        :label="isDefault ? t('email.page.defaultServer') : t('email.page.makeDefaultServer', { name: provider.name })"
        @star="handleStar"
      />
      <span
        v-if="editable"
        class="pointer-events-none inline-flex size-7 items-center justify-center text-muted-foreground transition-opacity sm:opacity-0 sm:group-hover/row:opacity-100 sm:group-focus-within/row:opacity-100 [@media(hover:none)]:opacity-100"
        aria-hidden="true"
      >
        <Pencil :size="14" />
      </span>
    </div>
  </div>
</template>
