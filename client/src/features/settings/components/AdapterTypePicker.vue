<script setup lang="ts">
export interface AdapterTypeOption {
  type: string
  label: string
  description?: string
  builtIn: boolean
}

/**
 * Choosing the kind of thing before filling the form in, rather than a select inside the form that
 * rewrites base URL, categories and every adapter setting under a half-filled draft.
 */
defineProps<{
  options: AdapterTypeOption[]
  selected: string | null
  legend: string
  name: string
  builtInLabel: string
  pluginLabel: string
}>()

const emit = defineEmits<{ select: [type: string] }>()

function handleSelect(type: string) {
  emit('select', type)
}
</script>

<template>
  <fieldset class="min-w-0">
    <legend class="sr-only">{{ legend }}</legend>
    <div class="grid gap-2 sm:grid-cols-2">
      <label v-for="option in options" :key="option.type" class="min-w-0 cursor-pointer">
        <input
          type="radio"
          class="peer sr-only"
          :name="name"
          :value="option.type"
          :checked="selected === option.type"
          @change="handleSelect(option.type)"
        />
        <span
          class="flex h-full flex-col gap-1 rounded-lg border border-border bg-card p-3 transition-colors peer-checked:border-primary peer-checked:ring-1 peer-checked:ring-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring hover:border-ring"
        >
          <span class="flex items-start justify-between gap-2">
            <span class="settings-label min-w-0">{{ option.label }}</span>
            <span class="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {{ option.builtIn ? builtInLabel : pluginLabel }}
            </span>
          </span>
          <span v-if="option.description" class="settings-hint">{{ option.description }}</span>
        </span>
      </label>
    </div>
  </fieldset>
</template>
