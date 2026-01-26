<script setup lang="ts">
defineProps<{ activeTab: string }>()
defineEmits<{ 'update:activeTab': [tab: string] }>()

const tabs = [
  { id: 'details', label: 'Details' },
  { id: 'files', label: 'Files' },
]

const futureTabs = [{ id: 'edit', label: 'Edit Metadata' }]
</script>

<template>
  <div class="flex items-center gap-0 overflow-x-auto flex-1 min-w-0">
    <button
      v-for="tab in tabs"
      :key="tab.id"
      class="px-3 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap"
      :class="activeTab === tab.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'"
      @click="$emit('update:activeTab', tab.id)"
    >
      {{ tab.label }}
    </button>
    <button
      v-for="tab in futureTabs"
      :key="tab.id"
      class="px-3 py-2.5 text-sm font-medium border-b-2 border-transparent text-muted-foreground/40 cursor-not-allowed whitespace-nowrap"
      disabled
    >
      {{ tab.label }}
    </button>
  </div>
</template>
