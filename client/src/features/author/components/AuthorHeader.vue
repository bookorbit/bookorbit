<script setup lang="ts">
import { computed, ref } from 'vue'
import type { AuthorDetail } from '@projectx/types'
import { MoreHorizontal, Pencil, RefreshCcw, Trash2, UsersRound, X } from 'lucide-vue-next'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

const props = defineProps<{
  author: AuthorDetail
  imageUrl?: string | null
  previewDescription?: string | null
  previewProvider?: string | null
  loadingPreview?: boolean
  canUpdate?: boolean
  canMerge?: boolean
  canDelete?: boolean
  refreshing?: boolean
}>()

const emit = defineEmits<{
  edit: []
  merge: []
  refresh: []
  delete: []
}>()

const initials = computed(() => {
  const parts = props.author.name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase()
  return `${parts[0]!.charAt(0)}${parts[1]!.charAt(0)}`.toUpperCase()
})

const resolvedBio = computed(() => {
  const local = props.author.description?.trim()
  if (local) return local
  return props.previewDescription?.trim() || ''
})

const usesPreviewBio = computed(() => !props.author.description?.trim() && !!props.previewDescription?.trim())

const lastAddedLabel = computed(() => {
  if (!props.author.lastAddedAt) return 'Never'
  const date = new Date(props.author.lastAddedAt)
  if (Number.isNaN(date.getTime())) return 'Never'
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
})

const previewProviderLabel = computed(() => {
  if (!props.previewProvider) return ''
  if (props.previewProvider === 'audnexus') return 'Audnexus'
  return props.previewProvider
})

const showMenu = computed(() => props.canUpdate || props.canMerge || props.canDelete)

const imageLightboxOpen = ref(false)
const canOpenImageLightbox = computed(() => Boolean(props.imageUrl))
</script>

<template>
  <section class="overflow-hidden rounded-xl border border-border/70 bg-card/80">
    <div class="bg-gradient-to-b from-primary/8 via-background/0 to-transparent p-4">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div
          class="h-44 w-32 shrink-0 overflow-hidden rounded-xl border border-border/70 bg-muted/40 shadow-sm"
          :class="canOpenImageLightbox ? 'cursor-zoom-in' : ''"
          @click="canOpenImageLightbox && (imageLightboxOpen = true)"
        >
          <img v-if="imageUrl" :src="imageUrl" :alt="`${author.name} portrait`" class="h-full w-full object-cover" />
          <div
            v-else
            class="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5 text-3xl font-semibold text-primary"
          >
            {{ initials }}
          </div>
        </div>

        <div class="min-w-0 flex-1">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <h1 class="truncate text-2xl font-semibold tracking-tight text-foreground">{{ author.name }}</h1>
              <p v-if="author.sortName && author.sortName !== author.name" class="text-sm text-muted-foreground">{{ author.sortName }}</p>
            </div>

            <DropdownMenu v-if="showMenu">
              <DropdownMenuTrigger as-child>
                <button
                  class="mt-0.5 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-muted px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/70"
                >
                  <MoreHorizontal :size="14" />
                  Actions
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-44">
                <DropdownMenuItem v-if="canUpdate" @click="emit('edit')">
                  <Pencil class="mr-2 h-4 w-4" />
                  Edit Author
                </DropdownMenuItem>
                <DropdownMenuItem v-if="canMerge" @click="emit('merge')">
                  <UsersRound class="mr-2 h-4 w-4" />
                  Merge Authors
                </DropdownMenuItem>
                <DropdownMenuSeparator v-if="canUpdate" />
                <DropdownMenuItem v-if="canUpdate" :disabled="refreshing" @click="emit('refresh')">
                  <RefreshCcw class="mr-2 h-4 w-4" :class="refreshing ? 'animate-spin' : ''" />
                  {{ refreshing ? 'Refreshing...' : 'Refresh Metadata' }}
                </DropdownMenuItem>
                <DropdownMenuSeparator v-if="canDelete && (canUpdate || canMerge)" />
                <DropdownMenuItem v-if="canDelete" class="text-destructive focus:text-destructive" @click="emit('delete')">
                  <Trash2 class="mr-2 h-4 w-4" />
                  Delete Author
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div class="mt-3">
            <p v-if="resolvedBio" class="text-sm leading-6 text-foreground/90">{{ resolvedBio }}</p>
            <p v-else-if="loadingPreview" class="text-sm text-muted-foreground">Looking up author metadata...</p>
            <p v-else class="text-sm text-muted-foreground">No biography available. Use the menu to refresh metadata.</p>
            <p v-if="usesPreviewBio && previewProviderLabel" class="mt-1.5 text-xs text-muted-foreground">
              Preview from {{ previewProviderLabel }}. Save metadata to persist it.
            </p>
          </div>

          <div class="mt-4 flex gap-3">
            <div class="rounded-lg border border-border/70 bg-background/40 px-4 py-2.5">
              <p class="text-base font-semibold text-foreground">{{ author.bookCount.toLocaleString() }}</p>
              <p class="text-xs text-muted-foreground">Books</p>
            </div>
            <div class="rounded-lg border border-border/70 bg-background/40 px-4 py-2.5">
              <p class="text-base font-semibold text-foreground">{{ lastAddedLabel }}</p>
              <p class="text-xs text-muted-foreground">Last Added</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <Teleport to="body">
    <div
      v-if="imageLightboxOpen && imageUrl"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      @click="imageLightboxOpen = false"
    >
      <button
        class="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
        @click="imageLightboxOpen = false"
      >
        <X class="size-5" />
      </button>
      <img :src="imageUrl" :alt="`${author.name} portrait`" class="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl" @click.stop />
    </div>
  </Teleport>
</template>
