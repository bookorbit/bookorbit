<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { parseCustomRuleFieldId, type GroupRule, type Rule } from '@bookorbit/types'
import { ruleToTokenParts } from '@/features/book/lib/filter-labels'
import type { ScopeTemplate } from '../lib/smart-scope-transfer'

const props = defineProps<{ group: GroupRule; customFields: ScopeTemplate['customFields'] }>()
const { t } = useI18n()

function describe(rule: Rule) {
  const { field, operator, value } = ruleToTokenParts(rule)
  const id = parseCustomRuleFieldId(rule.field)
  const label = id === null ? field : (props.customFields[id - 1]?.label ?? field)
  return [label, operator, value].filter(Boolean).join(' ')
}
</script>

<template>
  <div class="border-s border-border ps-3">
    <p class="text-sm font-medium text-foreground">{{ group.join === 'AND' ? t('book.filter.all') : t('book.filter.any') }}</p>
    <ul class="mt-1 space-y-1 text-sm text-muted-foreground">
      <li v-for="(rule, index) in group.rules" :key="index" class="[overflow-wrap:anywhere]">
        <SmartScopeTemplateRules v-if="rule.type === 'group'" :group="rule" :custom-fields="customFields" />
        <span v-else>{{ describe(rule) }}</span>
      </li>
    </ul>
  </div>
</template>
