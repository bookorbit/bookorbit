<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxTrigger,
  ComboboxViewport,
} from 'reka-ui'
import { Check, ChevronsUpDown } from '@lucide/vue'
import AuditResourceBadge from './AuditResourceBadge.vue'
import { AUDIT_RESOURCE_OPTIONS, getAuditResourceDotClass, getAuditResourceLabelKey } from './audit-resources'

const props = defineProps<{
  id: string
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const { t } = useI18n()
const allResourcesValue = '__all_resources__'
const open = ref(false)
const searchTerm = ref('')

const filteredResources = computed(() => {
  const query = searchTerm.value.trim().toLocaleLowerCase()
  if (!query) return AUDIT_RESOURCE_OPTIONS
  return AUDIT_RESOURCE_OPTIONS.filter((option) => `${t(getAuditResourceLabelKey(option.value))} ${option.value}`.toLocaleLowerCase().includes(query))
})

function handleSelect(value: unknown) {
  emit('update:modelValue', typeof value === 'string' && value !== allResourcesValue ? value : '')
}

function displayValue(value: unknown): string {
  return typeof value === 'string' && value ? t(getAuditResourceLabelKey(value)) : ''
}

watch(
  [() => props.modelValue, open],
  ([value, isOpen]) => {
    searchTerm.value = isOpen || !value ? '' : t(getAuditResourceLabelKey(value))
  },
  { flush: 'post', immediate: true },
)
</script>

<template>
  <ComboboxRoot v-model:open="open" :model-value="props.modelValue" :ignore-filter="true" @update:model-value="handleSelect">
    <ComboboxAnchor
      class="mt-1 inline-flex h-9 w-full items-center rounded-md border border-input bg-background text-sm text-foreground transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/40"
    >
      <span
        v-if="props.modelValue && !open"
        class="ms-2.5 size-2 shrink-0 rounded-full"
        :class="getAuditResourceDotClass(props.modelValue)"
        aria-hidden="true"
      />
      <ComboboxInput
        :id="props.id"
        v-model="searchTerm"
        :display-value="displayValue"
        :placeholder="t('audit.allTargetTypes')"
        class="h-full min-w-0 flex-1 bg-transparent px-2.5 outline-none placeholder:text-muted-foreground"
      />
      <ComboboxTrigger class="flex h-full shrink-0 items-center px-2.5 text-muted-foreground">
        <ChevronsUpDown :size="14" aria-hidden="true" />
      </ComboboxTrigger>
    </ComboboxAnchor>

    <ComboboxPortal>
      <ComboboxContent
        position="popper"
        :side-offset="4"
        class="z-[90] w-[var(--reka-combobox-trigger-width)] overflow-hidden rounded-md border border-border bg-popover shadow-md"
      >
        <ComboboxViewport class="max-h-72 overflow-y-auto p-1">
          <ComboboxItem
            :value="allResourcesValue"
            class="relative flex cursor-pointer items-center rounded-sm px-3 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
          >
            <ComboboxItemIndicator class="absolute end-2">
              <Check :size="14" aria-hidden="true" />
            </ComboboxItemIndicator>
            {{ t('audit.allTargetTypes') }}
          </ComboboxItem>
          <p v-if="filteredResources.length === 0" class="px-3 py-2 text-sm text-muted-foreground">{{ t('audit.noResourcesFound') }}</p>
          <ComboboxItem
            v-for="option in filteredResources"
            :key="option.value"
            :value="option.value"
            class="relative flex cursor-pointer items-center rounded-sm px-3 py-1.5 pe-8 outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
          >
            <ComboboxItemIndicator class="absolute end-2">
              <Check :size="14" aria-hidden="true" />
            </ComboboxItemIndicator>
            <AuditResourceBadge :resource="option.value" />
          </ComboboxItem>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
