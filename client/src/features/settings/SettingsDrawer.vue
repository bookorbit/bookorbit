<script setup lang="ts">
import { ref, shallowRef, watch } from 'vue'
import { X, Library, ScanLine, Paintbrush, BookOpen, FileText, BookImage, Info, ChevronLeft } from 'lucide-vue-next'
import { useSettingsDrawer } from '@/composables/useSettingsDrawer'
import LibrariesSettings from './LibrariesSettings.vue'
import ScannerSettings from './ScannerSettings.vue'
import AppearanceSettings from './AppearanceSettings.vue'
import EbookSettings from './EbookSettings.vue'
import PdfSettings from './PdfSettings.vue'
import ComicsSettings from './ComicsSettings.vue'
import AboutSettings from './AboutSettings.vue'

const { isOpen, close } = useSettingsDrawer()

type SectionId = 'libraries' | 'scanner' | 'appearance' | 'ebook' | 'pdf' | 'comics' | 'about'

const navGroups = [
  {
    label: 'General',
    items: [
      { id: 'libraries' as SectionId, label: 'Libraries', icon: Library, component: LibrariesSettings },
      { id: 'scanner' as SectionId, label: 'Scanner', icon: ScanLine, component: ScannerSettings },
      { id: 'appearance' as SectionId, label: 'Appearance', icon: Paintbrush, component: AppearanceSettings },
    ],
  },
  {
    label: 'Reader',
    items: [
      { id: 'ebook' as SectionId, label: 'eBook', icon: BookOpen, component: EbookSettings },
      { id: 'pdf' as SectionId, label: 'PDF', icon: FileText, component: PdfSettings },
      { id: 'comics' as SectionId, label: 'Comics', icon: BookImage, component: ComicsSettings },
    ],
  },
  {
    label: 'System',
    items: [{ id: 'about' as SectionId, label: 'About', icon: Info, component: AboutSettings }],
  },
]

const allItems = navGroups.flatMap((g) => g.items)
const activeId = ref<SectionId>('libraries')
const ActiveComponent = shallowRef(LibrariesSettings)

function navigate(id: SectionId) {
  activeId.value = id
  ActiveComponent.value = allItems.find((i) => i.id === id)!.component
}

watch(isOpen, (v) => {
  if (v) navigate('libraries')
})
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer-fade">
      <div v-if="isOpen" class="fixed inset-0 z-50 flex justify-end" @click.self="close">
        <!-- Backdrop -->
        <div class="absolute inset-0 bg-black/40 backdrop-blur-[2px]" @click="close" />

        <!-- Panel -->
        <Transition name="drawer-slide">
          <div
            v-if="isOpen"
            class="relative flex h-full w-full max-w-[900px] shadow-2xl overflow-hidden"
            style="border-left: 1px solid var(--border)"
          >
            <!-- Left nav -->
            <nav class="flex flex-col w-52 shrink-0 bg-muted/40 border-r border-border h-full">
              <div class="px-4 pt-5 pb-4 border-b border-border flex items-center justify-between">
                <span class="text-sm font-semibold text-foreground font-serif">Settings</span>
                <button
                  class="flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  @click="close"
                >
                  <X :size="14" />
                </button>
              </div>

              <div class="flex-1 overflow-y-auto py-3 px-2">
                <div v-for="group in navGroups" :key="group.label" class="mb-4">
                  <p class="px-2 mb-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest">
                    {{ group.label }}
                  </p>
                  <button
                    v-for="item in group.items"
                    :key="item.id"
                    class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors relative"
                    :class="
                      activeId === item.id
                        ? 'bg-background text-foreground font-medium shadow-sm'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
                    "
                    @click="navigate(item.id)"
                  >
                    <component :is="item.icon" :size="14" :class="activeId === item.id ? 'text-primary' : 'text-muted-foreground/70'" />
                    {{ item.label }}
                    <div v-if="activeId === item.id" class="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r bg-primary" />
                  </button>
                </div>
              </div>

              <div class="px-4 py-3 border-t border-border">
                <p class="text-[10px] text-muted-foreground/40">projectx · v0.1.0</p>
              </div>
            </nav>

            <!-- Content -->
            <main class="flex-1 overflow-y-auto bg-background">
              <component :is="ActiveComponent" />
            </main>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-fade-enter-active,
.drawer-fade-leave-active {
  transition: opacity 0.2s ease;
}
.drawer-fade-enter-from,
.drawer-fade-leave-to {
  opacity: 0;
}

.drawer-slide-enter-active,
.drawer-slide-leave-active {
  transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1);
}
.drawer-slide-enter-from,
.drawer-slide-leave-to {
  transform: translateX(100%);
}
</style>
