<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import EntityIndexView from '@/components/entity-index/EntityIndexView.vue'
import LibraryCreatorModal from '@/features/library/components/LibraryCreatorModal.vue'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useLibraryCreationRedirect } from '@/features/library/composables/useLibraryCreationRedirect'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import type { Library } from '@bookorbit/types'

defineOptions({ name: 'LibrariesView' })

const { t } = useI18n()
const { libraries, loading, fetchLibraries } = useLibraries()
const { hasPermission } = usePermissions()
const { handleLibraryCreated } = useLibraryCreationRedirect()

const createOpen = ref(false)
const canManageLibraries = computed(() => hasPermission('manage_libraries'))

function openCreate() {
  createOpen.value = true
}

function closeCreate() {
  createOpen.value = false
}

async function onLibrarySaved(library: Library) {
  createOpen.value = false
  await handleLibraryCreated(library)
}

onMounted(() => {
  void fetchLibraries()
})
</script>

<template>
  <LibraryCreatorModal v-if="createOpen" @close="closeCreate" @saved="onLibrarySaved" />
  <EntityIndexView
    :title="t('titles.libraries')"
    title-icon="BookCopy"
    fallback-icon="BookCopy"
    :items="libraries"
    route-name="library"
    :loading="loading"
    :search-placeholder="t('components.sidebar.filterLibrariesPlaceholder')"
    :empty-title="t('components.sidebar.noLibraries')"
    :empty-hint="t('components.entityIndex.librariesEmptyHint')"
    :can-add="canManageLibraries"
    :add-label="t('components.sidebar.newLibrary')"
    @add="openCreate"
  />
</template>
