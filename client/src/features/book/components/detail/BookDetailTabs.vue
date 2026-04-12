<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { normalizeBookDetailTab, type BookDetailTab } from '@/features/book/lib/book-detail-tabs'
import { usePermissions } from '@/features/auth/composables/usePermissions'

const props = defineProps<{ bookId: number }>()
const route = useRoute()
const router = useRouter()
const { hasPermission } = usePermissions()

const activeTab = computed(() => normalizeBookDetailTab(route.query.tab))

const tabs = computed<{ label: string; tab: BookDetailTab }[]>(() => {
  const result: { label: string; tab: BookDetailTab }[] = [{ label: 'Details', tab: 'details' }]
  if (hasPermission('library_edit_metadata')) {
    result.push({ label: 'Edit Metadata', tab: 'edit' })
  }
  result.push({ label: 'Files', tab: 'files' })
  return result
})

function navigate(tab: BookDetailTab) {
  router.push({ name: 'book-detail', params: { bookId: props.bookId }, query: { tab } })
}
</script>

<template>
  <div class="flex items-stretch gap-0 overflow-x-auto scrollbar-none flex-1 min-w-0">
    <button
      v-for="t in tabs"
      :key="t.tab"
      class="px-3.5 sm:px-3 h-full text-[15px] sm:text-sm font-semibold sm:font-medium border-b-2 transition-colors whitespace-nowrap"
      :class="activeTab === t.tab ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'"
      @click="navigate(t.tab)"
    >
      {{ t.label }}
    </button>
  </div>
</template>
