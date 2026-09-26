<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import EntityIndexView from '@/components/entity-index/EntityIndexView.vue'
import LibraryCreatorModal from '@/features/library/components/LibraryCreatorModal.vue'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useLibraryCreationRedirect } from '@/features/library/composables/useLibraryCreationRedirect'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { Permission, type Library } from '@bookorbit/types'

defineOptions({ name: 'PodcastLibrariesView' })

const { t } = useI18n()
const { libraries, loading, fetchLibraries } = useLibraries()
const { hasPermission } = usePermissions()
const { handleLibraryCreated } = useLibraryCreationRedirect()

const createOpen = ref(false)
const canManageLibraries = computed(() => hasPermission(Permission.ManageLibraries))
const podcastLibraries = computed(() => libraries.value.filter((library) => library.type === 'podcasts'))

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
  <LibraryCreatorModal v-if="createOpen" initial-type="podcasts" @close="closeCreate" @saved="onLibrarySaved" />
  <EntityIndexView
    :title="t('titles.podcastLibraries')"
    title-icon="Podcast"
    fallback-icon="Podcast"
    :items="podcastLibraries"
    route-name="podcast-library"
    :loading="loading"
    :search-placeholder="t('components.sidebar.filterPodcastLibrariesPlaceholder')"
    :empty-title="t('components.sidebar.noPodcastLibraries')"
    :empty-hint="t('components.entityIndex.podcastLibrariesEmptyHint')"
    :count-sort-label="t('components.entityIndex.sort.showCount')"
    :can-add="canManageLibraries"
    :add-label="t('components.sidebar.newPodcastLibrary')"
    @add="openCreate"
  />
</template>
