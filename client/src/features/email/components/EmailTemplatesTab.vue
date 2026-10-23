<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { FileText, Pencil, Plus, Tablet } from '@lucide/vue'

import { Button } from '@/components/ui/button'
import EmailStarButton from './EmailStarButton.vue'
import EmailTile from './EmailTile.vue'
import EmailTokenText from './EmailTokenText.vue'
import type { EmailTemplate } from '../composables/useEmailTemplates'

const props = defineProps<{ templates: EmailTemplate[]; defaultTemplateId: number | null; busy?: boolean }>()
const emit = defineEmits<{ add: []; edit: [template: EmailTemplate]; makeDefault: [template: EmailTemplate] }>()

const { t } = useI18n()

/** The built-in template leads; the rest keep the server's order. */
const ordered = computed(() => [...props.templates.filter((tpl) => tpl.isSystem), ...props.templates.filter((tpl) => !tpl.isSystem)])

function handleAdd() {
  emit('add')
}
function handleEdit(template: EmailTemplate) {
  emit('edit', template)
}
function handleMakeDefault(template: EmailTemplate) {
  emit('makeDefault', template)
}
</script>

<template>
  <section>
    <div class="mb-3 flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 sm:flex-nowrap">
      <h3 class="text-xs font-semibold tracking-[0.05em] whitespace-nowrap uppercase text-muted-foreground">{{ t('email.page.templates') }}</h3>
      <p class="order-3 min-w-0 basis-full text-[12.5px] text-muted-foreground sm:order-none sm:basis-auto">{{ t('email.page.templatesHint') }}</p>
      <Button size="sm" class="ms-auto h-7 gap-[5px] rounded-[7px] px-[9px] text-[13px] has-[>svg]:px-[9px]" @click="handleAdd">
        <Plus :size="14" aria-hidden="true" />{{ t('email.page.newTemplate') }}
      </Button>
    </div>

    <ul class="settings-card">
      <li v-for="template in ordered" :key="template.id">
        <div class="group/row relative flex min-h-16 items-center gap-x-3.5 px-3.5 py-3 transition-colors hover:bg-foreground/[0.025] sm:px-4">
          <button
            type="button"
            class="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            :aria-label="t('email.page.editTemplate', { name: template.name })"
            @click="handleEdit(template)"
          />
          <EmailTile :icon="FileText" color="var(--muted-foreground)" :size="36" class="pointer-events-none" />
          <div class="pointer-events-none min-w-0 flex-1">
            <p class="flex min-w-0 items-center gap-2 text-sm leading-[1.45] font-medium text-foreground">
              <span class="truncate">{{ template.name }}</span>
              <span
                v-if="template.isSystem"
                class="shrink-0 rounded-xs bg-muted px-1.5 text-[10px] leading-[18px] font-semibold text-muted-foreground"
              >
                {{ t('email.page.builtIn') }}
              </span>
            </p>
            <p class="mt-[3px] truncate font-mono text-xs leading-[1.45] text-foreground"><EmailTokenText :text="template.subject" /></p>
          </div>
          <div class="flex shrink-0 items-center gap-1 sm:ms-4">
            <EmailStarButton
              :on="template.id === defaultTemplateId"
              :busy="busy"
              :label="
                template.id === defaultTemplateId ? t('email.page.defaultTemplate') : t('email.page.makeDefaultTemplate', { name: template.name })
              "
              @star="handleMakeDefault(template)"
            />
            <span
              class="pointer-events-none inline-flex size-7 items-center justify-center text-muted-foreground transition-opacity sm:opacity-0 sm:group-hover/row:opacity-100 sm:group-focus-within/row:opacity-100 [@media(hover:none)]:opacity-100"
              aria-hidden="true"
            >
              <Pencil :size="14" />
            </span>
          </div>
        </div>
      </li>
    </ul>

    <p class="mt-3 flex items-start gap-[9px] text-[12.5px] leading-[1.7] text-muted-foreground">
      <Tablet :size="14" class="mt-1 shrink-0 text-[var(--format-kindle)]" aria-hidden="true" />
      <i18n-t keypath="email.page.kindleTemplateNote" tag="span" scope="global">
        <template #subject><span class="font-mono text-foreground">convert</span></template>
      </i18n-t>
    </p>
  </section>
</template>
