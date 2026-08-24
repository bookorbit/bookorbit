<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Globe, Library } from '@lucide/vue'
import type { FieldRuleScope, FieldRuleScopeId } from '../composables/useFieldRuleScopes'

const { t } = useI18n()

defineProps<{ scopes: FieldRuleScope[]; activeId: FieldRuleScopeId }>()
const emit = defineEmits<{ select: [id: FieldRuleScopeId] }>()

function select(id: FieldRuleScopeId) {
  emit('select', id)
}
</script>

<template>
  <div
    role="tablist"
    :aria-label="t('settings.metadata.fieldRules.scope.label')"
    class="flex items-stretch gap-1 overflow-x-auto border-b border-border px-2 md:gap-0 md:px-4"
  >
    <button
      v-for="(scope, index) in scopes"
      :key="String(scope.id)"
      type="button"
      role="tab"
      :aria-selected="scope.id === activeId"
      :class="[
        'flex shrink-0 items-center gap-2 whitespace-nowrap px-3 py-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
        'border-b-2 -mb-px',
        scope.id === activeId
          ? 'border-primary font-semibold text-foreground'
          : 'border-transparent font-medium text-muted-foreground hover:text-foreground',
        index === 1 ? 'md:ml-3 md:border-l md:border-l-border md:pl-4' : '',
      ]"
      @click="select(scope.id)"
    >
      <component :is="scope.isGlobal ? Globe : Library" :size="14" class="shrink-0" aria-hidden="true" />
      <span>{{ scope.name }}</span>
      <span
        v-if="scope.unsavedCount > 0"
        class="size-1.5 shrink-0 rounded-full bg-warning"
        :aria-label="t('settings.metadata.fieldRules.scope.unsavedMarker')"
      />
      <span
        v-else-if="scope.overrideCount > 0"
        class="rounded bg-primary/15 px-1.5 py-px text-[10px] font-bold tabular-nums text-primary"
        :aria-label="t('settings.metadata.fieldRules.scope.overrideCount', { count: scope.overrideCount })"
      >
        {{ scope.overrideCount }}
      </span>
    </button>
  </div>
</template>
