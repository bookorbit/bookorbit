<script setup lang="ts">
import { ref } from 'vue'
import { BookOpen, Plus, Users } from 'lucide-vue-next'
import LibraryCreatorModal from '@/features/library/components/LibraryCreatorModal.vue'
import { useLibraries } from '@/features/library/composables/useLibraries'

defineProps<{ canCreate: boolean }>()

const { refreshLibraries } = useLibraries()
const createOpen = ref(false)

function handleOpenCreate() {
  createOpen.value = true
}

function handleClose() {
  createOpen.value = false
}

async function handleSaved() {
  createOpen.value = false
  await refreshLibraries()
}
</script>

<template>
  <div class="flex items-center justify-center py-16 px-4">
    <div class="relative w-full max-w-md overflow-hidden rounded-2xl border border-primary/40 bg-card/30 shadow-sm backdrop-blur-[1px]">
      <!-- Glow backdrop -->
      <div
        class="pointer-events-none absolute inset-0"
        style="
          background-image: radial-gradient(ellipse 80% 60% at 50% -10%, color-mix(in oklch, var(--primary) 18%, transparent) 0%, transparent 100%);
        "
      />

      <div class="relative flex flex-col items-center px-10 py-12 text-center">
        <!-- Icon -->
        <div class="mb-6 flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-background shadow-sm">
          <component :is="canCreate ? BookOpen : Users" :size="26" class="text-foreground/70" />
        </div>

        <!-- Heading -->
        <h2 class="mb-2 text-lg font-bold tracking-tight text-foreground">
          {{ canCreate ? 'Your library is empty' : 'No libraries yet' }}
        </h2>

        <!-- Description -->
        <p class="mb-8 max-w-xs text-sm leading-relaxed text-muted-foreground">
          <template v-if="canCreate">
            Create a library to start organizing and reading your books. Point it to a folder and it will do the rest.
          </template>
          <template v-else> Your administrator hasn't set up any libraries yet. Reach out to them to get started. </template>
        </p>

        <!-- CTA -->
        <button
          v-if="canCreate"
          class="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          @click="handleOpenCreate"
        >
          <Plus :size="15" />
          Create your first library
        </button>
      </div>
    </div>
  </div>

  <LibraryCreatorModal v-if="createOpen" @close="handleClose" @saved="handleSaved" />
</template>
