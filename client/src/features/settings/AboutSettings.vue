<script setup lang="ts">
import { BookOpen, Database, Github, Server } from 'lucide-vue-next'
import SettingsPageHeader from './SettingsPageHeader.vue'

const stack = [
  { label: 'Frontend', value: 'Vue 3 + TypeScript + Tailwind CSS v4' },
  { label: 'Backend', value: 'NestJS 11 + Fastify' },
  { label: 'Database', value: 'PostgreSQL + Drizzle ORM' },
  { label: 'EPUB Engine', value: 'Foliate (epub.js)' },
  { label: 'PDF Engine', value: 'PDF.js' },
]
</script>

<template>
  <SettingsPageHeader title="About" subtitle="Information about this application." />

  <!-- App identity -->
  <div class="mb-6">
    <div class="border border-border rounded-lg bg-card px-5 py-5 flex items-start gap-4">
      <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10">
        <BookOpen :size="22" class="text-primary" />
      </div>
      <div>
        <p class="text-base font-semibold text-foreground font-serif">projectx</p>
        <p class="settings-hint">Version 0.1.0 (early development)</p>
        <p class="text-xs text-muted-foreground mt-2 leading-relaxed max-w-lg">
          A self-hosted book and library management application with support for EPUB, PDF, and comic formats.
        </p>
      </div>
    </div>
  </div>

  <!-- Tech stack -->
  <div class="mb-6">
    <p class="settings-group-label">Tech Stack</p>
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
      <div v-for="item in stack" :key="item.label" class="flex items-center justify-between px-5 py-3.5 bg-card">
        <p class="text-sm text-muted-foreground">{{ item.label }}</p>
        <p class="settings-label">{{ item.value }}</p>
      </div>
    </div>
  </div>

  <!-- Server info -->
  <div class="mb-6">
    <p class="settings-group-label">Server</p>
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
      <div class="flex items-center gap-3 px-5 py-4 bg-card">
        <Server :size="15" class="text-muted-foreground shrink-0" />
        <div>
          <p class="settings-label">API</p>
          <p class="text-xs text-muted-foreground font-mono mt-0.5">/api</p>
        </div>
      </div>
      <div class="flex items-center gap-3 px-5 py-4 bg-card">
        <Database :size="15" class="text-muted-foreground shrink-0" />
        <div>
          <p class="settings-label">Database</p>
          <p class="settings-hint">PostgreSQL</p>
        </div>
      </div>
    </div>
  </div>

  <!-- Links -->
  <div>
    <p class="settings-group-label">Links</p>
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border">
      <a
        href="https://github.com/neonsolstice/projectx"
        target="_blank"
        rel="noopener noreferrer"
        class="flex items-center gap-3 px-5 py-4 bg-card hover:bg-muted/50 transition-colors group"
      >
        <Github :size="15" class="text-muted-foreground shrink-0" />
        <div class="flex-1">
          <p class="settings-label group-hover:text-primary transition-colors">GitHub</p>
          <p class="settings-hint">Source code and issue tracker</p>
        </div>
      </a>
    </div>
  </div>
</template>
