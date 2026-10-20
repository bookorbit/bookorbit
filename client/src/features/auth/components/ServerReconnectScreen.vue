<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ServerOff } from '@lucide/vue'
import { useSessionBootstrap } from '../composables/useSessionBootstrap'
import AuthAlert from './AuthAlert.vue'
import AuthPlate from './AuthPlate.vue'
import AuthSubmit from './AuthSubmit.vue'

const { t } = useI18n()
const { retryNow } = useSessionBootstrap()

const retrying = ref(false)

async function handleRetry() {
  retrying.value = true
  try {
    await retryNow()
  } finally {
    retrying.value = false
  }
}
</script>

<template>
  <AuthPlate :heading="t('auth.reconnect.heading')">
    <form class="flex flex-col gap-4" @submit.prevent="handleRetry">
      <AuthAlert tone="notice" :icon="ServerOff">{{ t('auth.reconnect.description') }}</AuthAlert>
      <AuthSubmit :label="t('auth.reconnect.retry')" :loading-label="t('auth.reconnect.retrying')" :loading="retrying" />
    </form>
  </AuthPlate>
</template>
