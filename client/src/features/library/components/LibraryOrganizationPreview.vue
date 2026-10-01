<script setup lang="ts">
import { computed, type Component } from 'vue'
import { FileAudio, FileText, Folder, Image } from '@lucide/vue'
import type { OrganizationMode } from '@bookorbit/types'

const props = defineProps<{ mode: OrganizationMode }>()

interface TreeLine {
  name: string
  icon: Component
  child: boolean
  muted?: boolean
}

// Sample file names, not interface copy: they show the shape of a folder, so they stay untranslated.
const lines = computed<TreeLine[]>(() =>
  props.mode === 'book_per_folder'
    ? [
        { name: 'Dune/', icon: Folder, child: false },
        { name: 'Dune.epub', icon: FileText, child: true },
        { name: 'Dune.m4b', icon: FileAudio, child: true },
        { name: 'cover.jpg', icon: Image, child: true, muted: true },
      ]
    : [
        { name: 'Sci-Fi/', icon: Folder, child: false },
        { name: 'Dune.epub', icon: FileText, child: true },
        { name: 'Foundation.epub', icon: FileText, child: true },
        { name: 'Hyperion.epub', icon: FileText, child: true },
      ],
)
</script>

<template>
  <div class="rounded-lg border border-border bg-background px-2.5 py-2" dir="ltr" aria-hidden="true">
    <div
      v-for="line in lines"
      :key="line.name"
      class="flex h-5 items-center gap-1.5"
      :class="[line.child ? 'ps-4' : '', line.muted ? 'text-muted-foreground' : 'text-foreground']"
    >
      <span v-if="line.child" class="-ms-2.5 -mt-2.5 h-2.5 w-2 shrink-0 rounded-es-sm border-b border-s border-border" />
      <component :is="line.icon" :size="12" class="shrink-0" />
      <span class="truncate font-mono text-[11.5px]">{{ line.name }}</span>
    </div>
  </div>
</template>
