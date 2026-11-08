<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useLibraries } from '@/features/library/composables/useLibraries'
import ApiKeyManager from './components/ApiKeyManager.vue'

const { isSuperuser, userPermissions } = usePermissions()
const { libraries, fetchLibraries } = useLibraries()

const libraryOptions = computed(() => libraries.value.map((library) => ({ id: library.id, name: library.name })))

onMounted(() => {
  void fetchLibraries()
})
</script>

<template>
  <ApiKeyManager :owner-is-superuser="isSuperuser" :owner-permissions="userPermissions" :libraries="libraryOptions" />
</template>
