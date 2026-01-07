<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { FolderOpen, Plus, RefreshCw } from 'lucide-vue-next'

interface Library {
  id: number
  name: string
  createdAt: string
}

const libraries = ref<Library[]>([])
const scanning = ref<Record<number, boolean>>({})
const scanningAll = ref(false)

onMounted(async () => {
  const res = await fetch('/api/libraries')
  if (res.ok) libraries.value = await res.json()
})

async function scan(lib: Library) {
  scanning.value[lib.id] = true
  try {
    await fetch(`/api/scanner/libraries/${lib.id}/scan`, { method: 'POST' })
  } finally {
    scanning.value[lib.id] = false
  }
}

async function scanAll() {
  scanningAll.value = true
  try {
    await Promise.all(libraries.value.map((lib) => fetch(`/api/scanner/libraries/${lib.id}/scan`, { method: 'POST' })))
  } finally {
    scanningAll.value = false
  }
}
</script>

<template>
  <div class="px-5 py-6 sm:px-10 sm:py-8 max-w-3xl">
    <!-- Header -->
    <div class="flex items-start justify-between mb-8">
      <div>
        <h2 class="font-serif font-semibold text-foreground text-2xl tracking-tight">Libraries</h2>
        <p class="mt-1 text-sm text-muted-foreground">Manage your media libraries and trigger content scans.</p>
      </div>
      <div class="flex items-center gap-2 shrink-0 ml-4">
        <button
          class="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50"
          :disabled="scanningAll || libraries.length === 0"
          @click="scanAll"
        >
          <RefreshCw :size="12" :class="scanningAll ? 'animate-spin' : ''" />
          {{ scanningAll ? 'Scanning…' : 'Scan All' }}
        </button>
        <button
          class="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity opacity-50 cursor-not-allowed"
          disabled
          title="Coming soon"
        >
          <Plus :size="12" />
          Add Library
        </button>
      </div>
    </div>

    <!-- Library list -->
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
      <div v-for="lib in libraries" :key="lib.id" class="bg-card px-5 py-4">
        <div class="flex items-center gap-4">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <FolderOpen :size="17" class="text-primary" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <p class="text-sm font-medium text-foreground truncate">{{ lib.name }}</p>
            </div>
            <p class="text-xs text-muted-foreground mt-0.5">
              Added {{ new Date(lib.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) }}
            </p>
          </div>
          <button
            class="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-border hover:bg-muted transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50 shrink-0"
            :disabled="scanning[lib.id]"
            @click="scan(lib)"
          >
            <RefreshCw :size="12" :class="scanning[lib.id] ? 'animate-spin' : ''" />
            {{ scanning[lib.id] ? 'Scanning…' : 'Scan' }}
          </button>
        </div>
      </div>

      <div v-if="libraries.length === 0" class="bg-card px-5 py-12 text-center">
        <FolderOpen :size="28" class="text-muted-foreground/30 mx-auto mb-3" />
        <p class="text-sm text-muted-foreground">No libraries configured yet.</p>
      </div>
    </div>

    <!-- Info note -->
    <div class="mt-6 rounded-lg border border-border bg-muted/40 px-5 py-4">
      <p class="text-xs font-medium text-foreground mb-1">Library folders</p>
      <p class="text-xs text-muted-foreground leading-relaxed">
        Libraries are configured via the server environment and database. Folder path management and adding new libraries from the UI will be
        available in a future update.
      </p>
    </div>
  </div>
</template>
