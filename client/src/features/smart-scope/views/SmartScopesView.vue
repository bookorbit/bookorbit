<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { Aperture, FileUp } from '@lucide/vue'
import EntityIndexView from '@/components/entity-index/EntityIndexView.vue'
import { Button } from '@/components/ui/button'
import CreateSmartScopeDialog from '@/features/smart-scope/components/CreateSmartScopeDialog.vue'
import ImportSmartScopeDialog from '@/features/smart-scope/components/ImportSmartScopeDialog.vue'
import { useSmartScopes } from '@/features/smart-scope/composables/useSmartScopes'

defineOptions({ name: 'SmartScopesView' })

const { t } = useI18n()
const router = useRouter()
const { smartScopes, loading, fetchSmartScopes } = useSmartScopes()

const createOpen = ref(false)
const importOpen = ref(false)

function openCreate() {
  createOpen.value = true
}

function closeCreate() {
  createOpen.value = false
}

function openImport() {
  importOpen.value = true
}

function closeImport() {
  importOpen.value = false
}

function openImportedScope(id: number) {
  closeImport()
  void router.push({ name: 'smartScope', params: { id } })
}

onMounted(() => {
  void fetchSmartScopes()
})
</script>

<template>
  <div class="h-full">
    <CreateSmartScopeDialog :open="createOpen" @close="closeCreate" />
    <ImportSmartScopeDialog v-if="importOpen" @close="closeImport" @imported="openImportedScope" />
    <EntityIndexView
      :title="t('titles.smartScopes')"
      :title-icon="Aperture"
      :fallback-icon="Aperture"
      :items="smartScopes"
      route-name="smartScope"
      :loading="loading"
      :search-placeholder="t('components.sidebar.filterSmartScopesPlaceholder')"
      :empty-title="t('components.sidebar.noSmartScopes')"
      :empty-hint="t('components.entityIndex.smartScopesEmptyHint')"
      can-add
      :add-label="t('components.sidebar.newSmartScope')"
      @add="openCreate"
    >
      <template #secondary-actions>
        <Button type="button" variant="outline" size="sm" @click="openImport">
          <FileUp aria-hidden="true" />
          {{ t('smartScope.transfer.importTitle') }}
        </Button>
      </template>
    </EntityIndexView>
  </div>
</template>
