<script setup lang="ts">
import JobsAreaHeader from '../components/JobsAreaHeader.vue'
</script>

<template>
  <div class="mx-auto flex w-full max-w-420 flex-col pt-2 pb-4">
    <JobsAreaHeader />
    <router-view />
  </div>
</template>
