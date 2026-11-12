<script setup lang="ts">
import AiAreaHeader from '../components/AiAreaHeader.vue'
</script>

<template>
  <div class="mx-auto flex w-full max-w-420 flex-col pt-2 pb-4">
    <AiAreaHeader />
    <router-view />
  </div>
</template>
