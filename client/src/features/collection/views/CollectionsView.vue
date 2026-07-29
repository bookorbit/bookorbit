<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import EntityIndexView from '@/components/entity-index/EntityIndexView.vue'
import CreateCollectionDialog from '@/features/collection/components/CreateCollectionDialog.vue'
import { useCollections } from '@/features/collection/composables/useCollections'

defineOptions({ name: 'CollectionsView' })

const { t } = useI18n()
const { collections, loading, fetchCollections } = useCollections()

const createOpen = ref(false)

function openCreate() {
  createOpen.value = true
}

function closeCreate() {
  createOpen.value = false
}

onMounted(() => {
  void fetchCollections()
})
</script>

<template>
  <CreateCollectionDialog :open="createOpen" @close="closeCreate" />
  <EntityIndexView
    :title="t('titles.collections')"
    title-icon="FolderOpen"
    fallback-icon="FolderOpen"
    :items="collections"
    route-name="collection"
    :loading="loading"
    :search-placeholder="t('components.sidebar.filterCollectionsPlaceholder')"
    :empty-title="t('components.sidebar.noCollections')"
    :empty-hint="t('components.entityIndex.collectionsEmptyHint')"
    can-add
    :add-label="t('components.sidebar.newCollection')"
    @add="openCreate"
  />
</template>
