<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'

const props = defineProps<{ bookId: number }>()
const route = useRoute()
const router = useRouter()

const tabs = [
  { label: 'Details', routeName: 'book-detail' },
  { label: 'Edit Metadata', routeName: 'book-edit' },
  { label: 'Files', routeName: 'book-files' },
]

function navigate(routeName: string) {
  router.push({ name: routeName, params: { bookId: props.bookId } })
}
</script>

<template>
  <div class="flex items-stretch gap-0 overflow-x-auto flex-1 min-w-0">
    <button
      v-for="tab in tabs"
      :key="tab.routeName"
      class="px-3 h-full text-sm font-medium border-b-2 transition-colors whitespace-nowrap"
      :class="route.name === tab.routeName ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'"
      @click="navigate(tab.routeName)"
    >
      {{ tab.label }}
    </button>
  </div>
</template>
