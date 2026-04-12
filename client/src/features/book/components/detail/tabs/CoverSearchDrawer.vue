<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { Search, Loader2, X, Image as ImageIcon, Check } from 'lucide-vue-next'
import type { CoverSearchResult } from '@projectx/types'

const props = defineProps<{
  initialTitle: string
  initialAuthor: string
  isAudiobook: boolean
}>()

const emit = defineEmits<{
  close: []
  select: [string]
}>()

const searchTitle = ref(props.initialTitle)
const searchAuthor = ref(props.initialAuthor)
const searchProvider = ref<'duckduckgo' | 'itunes' | 'all'>('duckduckgo')
const isSearching = ref(false)
const searchResults = ref<CoverSearchResult[]>([])
const hasSearched = ref(false)
const titleInput = ref<HTMLInputElement | null>(null)

async function performSearch() {
  if (!searchTitle.value.trim()) return
  isSearching.value = true
  hasSearched.value = true
  searchResults.value = []
  try {
    const params = new URLSearchParams({
      title: searchTitle.value.trim(),
      author: searchAuthor.value.trim(),
      isAudiobook: String(props.isAudiobook),
      provider: searchProvider.value,
    })
    const res = await fetch(`/api/v1/books/cover/search?${params}`)
    if (!res.ok) throw new Error('Search failed')
    searchResults.value = await res.json()
  } catch (err) {
    console.error('Search error:', err)
  } finally {
    isSearching.value = false
  }
}

function handleSelect(url: string) {
  emit('select', url)
  emit('close')
}

onMounted(() => {
  nextTick(() => titleInput.value?.focus())
})
</script>

<template>
  <div class="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" @click.self="emit('close')">
    <div class="w-full max-w-2xl bg-background h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
      <!-- Header -->
      <div class="flex items-center justify-between p-4 border-b">
        <div class="flex items-center gap-2">
          <div class="p-2 rounded-lg bg-primary/10 text-primary">
            <Search class="size-5" />
          </div>
          <div>
            <h2 class="text-sm font-semibold">Online Search</h2>
            <p class="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Search for book covers</p>
          </div>
        </div>
        <button class="p-2 hover:bg-muted rounded-full transition-colors" @click="emit('close')">
          <X class="size-5" />
        </button>
      </div>

      <!-- Search Bar (Sticky) -->
      <div class="p-4 bg-muted/30 border-b space-y-3">
        <div class="grid grid-cols-2 md:grid-cols-3 gap-2 md:gap-3">
          <div class="space-y-1">
            <label class="hidden md:block text-[10px] font-bold text-muted-foreground ml-1 uppercase">Title</label>
            <input
              ref="titleInput"
              v-model="searchTitle"
              class="w-full h-9 md:h-10 rounded-xl border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              placeholder="Title"
              @keyup.enter="performSearch"
            />
          </div>
          <div class="space-y-1">
            <label class="hidden md:block text-[10px] font-bold text-muted-foreground ml-1 uppercase">Author</label>
            <input
              v-model="searchAuthor"
              class="w-full h-9 md:h-10 rounded-xl border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              placeholder="Author"
              @keyup.enter="performSearch"
            />
          </div>
          <div class="col-span-2 md:col-span-1 flex gap-2 md:block md:space-y-1">
            <div class="flex-1 md:space-y-1">
              <label class="hidden md:block text-[10px] font-bold text-muted-foreground ml-1 uppercase">Source</label>
              <select
                v-model="searchProvider"
                class="w-full h-9 md:h-10 rounded-xl border border-input bg-background px-3 text-sm focus:ring-2 focus:ring-primary/20 outline-none transition-all"
              >
                <option value="duckduckgo">DuckDuckGo</option>
                <option value="itunes">iTunes</option>
                <option value="all">All Sources</option>
              </select>
            </div>
            <!-- Icon-only search button on mobile, inline with Source -->
            <button
              class="md:hidden flex items-center justify-center h-9 aspect-square rounded-xl bg-primary text-primary-foreground transition-all shadow-sm active:scale-[0.98] disabled:opacity-50 shrink-0"
              :disabled="isSearching"
              @click="performSearch"
            >
              <Loader2 v-if="isSearching" class="size-4 animate-spin" />
              <Search v-else class="size-4" />
            </button>
          </div>
        </div>
        <!-- Full-width button on md+ -->
        <button
          class="hidden md:flex items-center justify-center gap-2 w-full h-10 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-all shadow-sm active:scale-[0.98]"
          :disabled="isSearching"
          @click="performSearch"
        >
          <Loader2 v-if="isSearching" class="size-4 animate-spin" />
          <Search v-else class="size-4" />
          {{ isSearching ? 'Searching...' : 'Find covers' }}
        </button>
      </div>

      <!-- Results Scroll Area -->
      <div class="flex-1 overflow-y-auto p-4 custom-scrollbar">
        <div v-if="isSearching" class="grid grid-cols-3 gap-4">
          <div v-for="i in 9" :key="i" class="aspect-[2/3] rounded-xl bg-muted animate-pulse" />
        </div>

        <div v-else-if="searchResults.length > 0" class="grid grid-cols-3 gap-4">
          <div
            v-for="res in searchResults"
            :key="String(res.url)"
            class="group relative aspect-[2/3] rounded-xl overflow-hidden bg-muted border border-border/50 hover:border-primary/50 hover:ring-4 hover:ring-primary/10 transition-all cursor-pointer"
            @click="handleSelect(String(res.url))"
          >
            <img :src="res.previewUrl" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" loading="lazy" />

            <!-- Hover Overlay -->
            <div
              class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-2"
            >
              <div class="p-2 rounded-full bg-primary text-white scale-75 group-hover:scale-100 transition-transform">
                <Check class="size-5" />
              </div>
              <span class="text-xs font-bold text-white uppercase tracking-widest">Select Cover</span>
            </div>

            <!-- Resolution Badge -->
            <div
              class="absolute top-2 right-2 px-1.5 py-0.5 rounded-md text-[10px] font-bold text-white backdrop-blur-md shadow-sm"
              :class="res.width >= 1000 ? 'bg-green-500/80' : 'bg-black/50'"
            >
              {{ res.width }}x{{ res.height }}
            </div>

            <!-- Source Badge -->
            <div class="absolute bottom-2 left-2 px-1.5 py-0.5 rounded-md text-[10px] font-bold text-white bg-black/50 backdrop-blur-md shadow-sm">
              {{ res.source }}
            </div>
          </div>
        </div>

        <!-- Empty States -->
        <div v-else-if="hasSearched" class="h-full flex flex-col items-center justify-center text-center space-y-3 opacity-60 py-12">
          <div class="p-4 rounded-full bg-muted">
            <ImageIcon class="size-10 text-muted-foreground" />
          </div>
          <div>
            <h3 class="font-semibold">No results found</h3>
            <p class="text-xs text-muted-foreground">Try adjusting your search terms</p>
          </div>
        </div>
        <div v-else class="h-full flex flex-col items-center justify-center text-center space-y-3 opacity-60 py-12">
          <div class="p-4 rounded-full bg-muted">
            <Search class="size-10 text-muted-foreground" />
          </div>
          <div>
            <h3 class="font-semibold">Ready to search</h3>
            <p class="text-xs text-muted-foreground">Enter a title and author above</p>
          </div>
        </div>
      </div>

      <!-- Footer / Hint -->
      <div class="p-4 border-t bg-muted/10">
        <p class="text-[10px] text-center text-muted-foreground flex items-center justify-center gap-1">
          <ImageIcon class="size-3" />
          Tip: High resolution covers are marked in green
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 10px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.2);
}
</style>
