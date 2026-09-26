<script setup lang="ts">
import { usePodcastAnnouncer } from '../composables/usePodcastAnnouncer'

const { message } = usePodcastAnnouncer()
</script>

<template>
  <p class="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="podcast-live-region">{{ message }}</p>
</template>
