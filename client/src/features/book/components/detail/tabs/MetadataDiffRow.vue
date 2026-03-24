<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowLeft, RotateCcw, CheckCircle2, X, ZoomIn, Layers } from 'lucide-vue-next'
import type { MetadataProviderInfo, MetadataProviderKey } from '@projectx/types'
import type { DiffField, DiffFieldKey } from '../../../composables/useMetadataDiff'
import { hideOnError, providerBadgeStyle } from '../../../lib/metadata-fetch'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const props = defineProps<{
  field: DiffField
  activeProvider: MetadataProviderKey
  providers: MetadataProviderInfo[]
}>()

const emit = defineEmits<{
  toggle: [DiffFieldKey]
  pickFromProvider: [key: DiffFieldKey, provider: MetadataProviderKey]
}>()

const lightboxSrc = ref<string | null>(null)

const pickedProviderLabel = computed(() => {
  if (!props.field.pickedProvider) return ''
  return props.field.providerValues.find((pv) => pv.provider === props.field.pickedProvider)?.label ?? props.field.pickedProvider
})

function handleToggle() {
  emit('toggle', props.field.key)
}

function handlePickFromProvider(provider: MetadataProviderKey) {
  emit('pickFromProvider', props.field.key, provider)
}
</script>

<template>
  <!-- Cover row -->
  <div v-if="field.isCover" class="py-3.5 border-b border-border/40">
    <p class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2.5">{{ field.label }}</p>
    <div class="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
      <!-- Current cover -->
      <div
        class="w-16 rounded-lg overflow-hidden bg-muted transition-all duration-300 shadow-sm ring-1 relative group"
        :class="field.isPicked ? 'ring-primary ring-2' : field.bookValue ? 'ring-border cursor-zoom-in' : 'ring-border opacity-50'"
        style="aspect-ratio: 2/3"
        @click="
          field.isPicked ? (lightboxSrc = field.pickedDisplay || field.candidateDisplay) : field.bookValue ? (lightboxSrc = field.bookValue) : null
        "
      >
        <img
          v-if="field.isPicked && field.pickedDisplay"
          :src="field.pickedDisplay"
          alt="Preview"
          class="w-full h-full object-cover"
          @error="hideOnError"
        />
        <img v-else-if="field.bookValue" :src="field.bookValue" alt="Current cover" class="w-full h-full object-cover" @error="hideOnError" />
        <div v-else class="w-full h-full bg-linear-to-br from-muted to-muted-foreground/10" />
        <div
          v-if="field.isPicked || field.bookValue"
          class="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
        >
          <ZoomIn class="size-4 text-white" />
        </div>
        <!-- Picked-from-other indicator -->
        <div v-if="field.isPicked && !field.pickedFromActive && field.pickedProvider" class="absolute bottom-1 left-1 right-1">
          <span
            class="inline-flex items-center text-[8px] font-bold px-1 py-0.5 rounded w-full justify-center truncate"
            :style="providerBadgeStyle(field.pickedProvider)"
          >
            {{ pickedProviderLabel }}
          </span>
        </div>
      </div>

      <!-- Center: toggle + popover -->
      <div class="flex flex-col items-center gap-1 w-11">
        <button
          v-if="field.isCopyable && field.candidateDisplay"
          class="size-8 rounded-full flex items-center justify-center transition-all active:scale-90 shadow-sm"
          :class="
            field.isPicked
              ? 'bg-primary text-primary-foreground shadow-primary/30'
              : 'bg-card border border-border text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5'
          "
          @click="handleToggle"
        >
          <RotateCcw v-if="field.isPicked && field.pickedFromActive" class="size-3.5" />
          <Layers v-else-if="field.isPicked && !field.pickedFromActive" class="size-3.5" />
          <ArrowLeft v-else class="size-3.5" />
        </button>

        <Popover v-if="field.isCopyable && field.providerValues.length >= 2">
          <PopoverTrigger as-child>
            <button
              class="size-5 rounded-full flex items-center justify-center transition-all hover:bg-muted text-muted-foreground hover:text-foreground"
              title="Pick cover from another provider"
            >
              <Layers class="size-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent class="w-auto p-1.5" side="bottom" :side-offset="4">
            <div class="flex flex-col gap-1 min-w-48">
              <p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-1">Pick cover source</p>
              <button
                v-for="pv in field.providerValues"
                :key="pv.provider"
                class="flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors hover:bg-muted w-full"
                :class="field.pickedProvider === pv.provider ? 'bg-primary/8 ring-1 ring-inset ring-primary/20' : ''"
                @click="handlePickFromProvider(pv.provider)"
              >
                <span class="shrink-0 w-8 rounded overflow-hidden bg-muted" style="aspect-ratio: 2/3">
                  <img :src="pv.display" alt="" class="w-full h-full object-cover" @error="hideOnError" />
                </span>
                <span
                  class="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-md shrink-0"
                  :style="providerBadgeStyle(pv.provider)"
                >
                  {{ pv.label }}
                </span>
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <!-- New cover -->
      <div
        class="w-16 rounded-lg overflow-hidden bg-muted shadow-sm ring-1 transition-all duration-300 relative group"
        :class="
          field.candidateDisplay
            ? field.isPicked && field.pickedFromActive
              ? 'ring-primary ring-2 cursor-zoom-in'
              : 'ring-border cursor-zoom-in'
            : 'ring-border opacity-50'
        "
        style="aspect-ratio: 2/3"
        @click="field.candidateDisplay ? (lightboxSrc = field.candidateDisplay) : null"
      >
        <img v-if="field.candidateDisplay" :src="field.candidateDisplay" alt="New cover" class="w-full h-full object-cover" @error="hideOnError" />
        <div v-else class="w-full h-full bg-linear-to-br from-muted to-muted-foreground/10" />
        <div
          v-if="field.candidateDisplay"
          class="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
        >
          <ZoomIn class="size-4 text-white" />
        </div>
      </div>
    </div>
  </div>

  <!-- Text row -->
  <div v-else class="py-2.5 border-b border-border/40">
    <p class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">{{ field.label }}</p>

    <div class="flex flex-col gap-2 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:gap-1.5 sm:items-stretch">
      <!-- Current value -->
      <div
        class="min-w-0 rounded-lg px-3 py-2 transition-all duration-200"
        :class="!field.hasDiff ? 'bg-muted/30 opacity-50' : field.isPicked ? 'bg-muted/30 opacity-40' : 'bg-background ring-1 ring-border'"
      >
        <p class="text-[10px] font-medium text-muted-foreground mb-0.5 sm:hidden">Current</p>
        <p class="wrap-break-word leading-snug text-sm w-full" :class="!field.currentDisplay ? 'text-muted-foreground/60 italic' : 'text-foreground'">
          {{ field.currentDisplay || 'empty' }}
        </p>
        <!-- Badge when value is picked from a different provider than the active tab -->
        <span
          v-if="field.isPicked && !field.pickedFromActive && field.pickedProvider"
          class="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-md mt-1"
          :style="providerBadgeStyle(field.pickedProvider)"
        >
          {{ pickedProviderLabel }}
        </span>
      </div>

      <!-- Center: toggle + popover stacked -->
      <div class="flex items-center justify-center gap-0.5 w-11 sm:flex-col sm:justify-center">
        <button
          v-if="field.isCopyable && field.hasDiff"
          class="size-8 rounded-full flex items-center justify-center transition-all active:scale-90 shadow-sm shrink-0"
          :class="
            field.isPicked
              ? 'bg-primary text-primary-foreground shadow-primary/30'
              : 'bg-card border border-border text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5'
          "
          @click="handleToggle"
        >
          <RotateCcw v-if="field.isPicked && field.pickedFromActive" class="size-3.5" />
          <Layers v-else-if="field.isPicked && !field.pickedFromActive" class="size-3.5" />
          <ArrowLeft v-else class="size-3.5" />
        </button>
        <div v-else-if="field.isCopyable" class="size-8 flex items-center justify-center shrink-0">
          <CheckCircle2 class="size-3.5 text-muted-foreground/25" />
        </div>
        <div v-else class="size-8 shrink-0" />

        <Popover v-if="field.isCopyable && field.providerValues.length >= 2">
          <PopoverTrigger as-child>
            <button
              class="size-5 rounded-full flex items-center justify-center transition-all hover:bg-muted text-muted-foreground hover:text-foreground shrink-0"
              title="Pick from another provider"
            >
              <Layers class="size-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent class="w-auto p-1.5" side="bottom" :side-offset="4" align="center">
            <div class="flex flex-col gap-0.5 min-w-44 max-w-72">
              <p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-1">Pick source</p>
              <button
                v-for="pv in field.providerValues"
                :key="pv.provider"
                class="flex items-start gap-2 px-2 py-1.5 rounded-md text-left transition-colors hover:bg-muted w-full"
                :class="field.pickedProvider === pv.provider ? 'bg-primary/8 ring-1 ring-inset ring-primary/20' : ''"
                @click="handlePickFromProvider(pv.provider)"
              >
                <span
                  class="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded-md shrink-0 mt-0.5"
                  :style="providerBadgeStyle(pv.provider)"
                >
                  {{ pv.label }}
                </span>
                <span class="text-xs text-muted-foreground leading-snug line-clamp-2 min-w-0">{{ pv.display }}</span>
              </button>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <!-- New value -->
      <div
        class="min-w-0 rounded-lg px-3 py-2 transition-all duration-200"
        :class="
          !field.hasDiff ? 'bg-muted/30 opacity-50' : field.isPicked && field.pickedFromActive ? 'bg-primary/8 ring-1 ring-primary/20' : 'bg-muted/40'
        "
      >
        <p class="text-[10px] font-medium text-muted-foreground mb-0.5 sm:hidden">New</p>
        <a
          v-if="field.key === 'sourceUrl' && field.candidateDisplay"
          :href="field.candidateDisplay"
          target="_blank"
          rel="noopener noreferrer"
          class="wrap-break-word leading-snug text-sm w-full text-primary hover:underline"
        >
          {{ field.candidateDisplay }}
        </a>
        <p
          v-else
          class="wrap-break-word leading-snug text-sm w-full"
          :class="field.isPicked && field.pickedFromActive ? 'text-primary font-medium' : 'text-muted-foreground'"
        >
          {{ field.candidateDisplay }}
        </p>
      </div>
    </div>
  </div>

  <!-- Lightbox -->
  <Teleport to="body">
    <div v-if="lightboxSrc" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm" @click="lightboxSrc = null">
      <button
        class="absolute top-4 right-4 size-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
        @click="lightboxSrc = null"
      >
        <X class="size-5" />
      </button>
      <img
        :src="lightboxSrc"
        alt="Cover preview"
        class="max-h-[85vh] max-w-[85vw] rounded-xl shadow-2xl object-contain"
        @click.stop
        @error="hideOnError"
      />
    </div>
  </Teleport>
</template>
