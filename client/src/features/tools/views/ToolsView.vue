<script setup lang="ts">
import ToolsHeader from '../components/ToolsHeader.vue'
</script>

<template>
  <div class="flex flex-col mt-2 h-[calc(100%-0.5rem)] overflow-hidden rounded-lg border border-border/70 bg-card/40 shadow-sm">
    <ToolsHeader />
    <main class="flex-1 overflow-hidden">
      <div class="h-full md:px-6 px-4 pt-6 pb-4">
        <router-view v-slot="{ Component, route: childRoute }">
          <KeepAlive :max="3">
            <component :is="Component" :key="childRoute.name ?? childRoute.path" />
          </KeepAlive>
        </router-view>
      </div>
    </main>
  </div>
</template>
