<script setup lang="ts">
import { Library, BookMarked, Clock, BookOpen } from 'lucide-vue-next'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'

const navItems = [
  { id: 'library', label: 'All Books', icon: Library, active: true },
  { id: 'reading', label: 'Reading', icon: BookOpen, active: false },
  { id: 'bookmarks', label: 'Bookmarks', icon: BookMarked, active: false },
  { id: 'recent', label: 'Recently Added', icon: Clock, active: false },
]
</script>

<template>
  <Sidebar collapsible="icon" style="--sidebar-border: color-mix(in oklch, var(--primary) 18%, transparent)">
    <SidebarHeader class="border-b border-sidebar-border">
      <div class="flex items-center gap-2.5 px-1 py-1">
        <!-- Logo mark -->
        <div
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-sm"
          style="background: linear-gradient(135deg, var(--primary) 0%, color-mix(in oklch, var(--primary) 75%, transparent) 100%)"
        >
          <svg viewBox="0 0 20 20" fill="none" class="h-4 w-4" aria-hidden="true">
            <path
              d="M5 2.5A1.5 1.5 0 016.5 1h9A1.5 1.5 0 0117 2.5v15a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 015 17.5V2.5z"
              fill="var(--primary-foreground)"
              opacity="0.25"
            />
            <path d="M3 4a1 1 0 011-1h8.5A1.5 1.5 0 0114 4.5V17a1.5 1.5 0 01-1.5 1.5H4a1 1 0 01-1-1V4z" fill="var(--primary-foreground)" />
            <line x1="6" y1="7.5" x2="11.5" y2="7.5" stroke="var(--primary)" stroke-width="1.3" stroke-linecap="round" />
            <line x1="6" y1="10.5" x2="11.5" y2="10.5" stroke="var(--primary)" stroke-width="1.3" stroke-linecap="round" opacity="0.7" />
            <line x1="6" y1="13.5" x2="9.5" y2="13.5" stroke="var(--primary)" stroke-width="1.3" stroke-linecap="round" opacity="0.4" />
          </svg>
        </div>
        <!-- Brand name -->
        <div class="flex flex-col leading-none group-data-[collapsible=icon]:hidden">
          <span class="text-sm font-serif font-semibold text-sidebar-foreground leading-tight tracking-tight">
            project<span class="text-primary">x</span>
          </span>
          <span class="text-[10px] text-sidebar-foreground/40 mt-0.5">your reading world</span>
        </div>
      </div>
    </SidebarHeader>

    <SidebarContent>
      <SidebarGroup class="pt-2">
        <SidebarGroupLabel class="text-[10px] uppercase tracking-widest text-sidebar-foreground/35 font-medium group-data-[collapsible=icon]:hidden">
          Library
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="item in navItems" :key="item.id">
              <SidebarMenuButton :is-active="item.active" :tooltip="item.label" class="gap-2.5">
                <component :is="item.icon" :size="15" :class="item.active ? 'text-sidebar-primary' : 'text-sidebar-foreground/50'" />
                <span :class="item.active ? 'font-medium text-sidebar-foreground' : 'text-sidebar-foreground/70'">
                  {{ item.label }}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>

    <SidebarRail />
  </Sidebar>
</template>
