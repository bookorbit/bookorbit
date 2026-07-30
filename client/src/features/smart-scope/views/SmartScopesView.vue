<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import EntityIndexView from '@/components/entity-index/EntityIndexView.vue'
import CreateSmartScopeDialog from '@/features/smart-scope/components/CreateSmartScopeDialog.vue'
import { useSmartScopes } from '@/features/smart-scope/composables/useSmartScopes'

defineOptions({ name: 'SmartScopesView' })

const { t } = useI18n()
const { smartScopes, loading, fetchSmartScopes } = useSmartScopes()

const createOpen = ref(false)

function openCreate() {
  createOpen.value = true
}

function closeCreate() {
  createOpen.value = false
}

onMounted(() => {
  void fetchSmartScopes()
})
</script>

<template>
  <CreateSmartScopeDialog :open="createOpen" @close="closeCreate" />
  <EntityIndexView
    :title="t('titles.smartScopes')"
    title-icon="Aperture"
    fallback-icon="Aperture"
    :items="smartScopes"
    route-name="smartScope"
    :loading="loading"
    :search-placeholder="t('components.sidebar.filterSmartScopesPlaceholder')"
    :empty-title="t('components.sidebar.noSmartScopes')"
    :empty-hint="t('components.entityIndex.smartScopesEmptyHint')"
    can-add
    :add-label="t('components.sidebar.newSmartScope')"
    @add="openCreate"
  />
</template>
