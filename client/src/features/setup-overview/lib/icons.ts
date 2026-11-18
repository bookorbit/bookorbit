import {
  BookOpen,
  Bot,
  Check,
  CheckCheck,
  Download,
  FileText,
  FolderInput,
  FolderSearch,
  FolderSync,
  GitMerge,
  Inbox,
  Library,
  ListChecks,
  Mail,
  PackageOpen,
  RotateCw,
  Rss,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Tablet,
  Tag,
  Upload,
} from '@lucide/vue'
import type { Component } from 'vue'

/**
 * The glyphs a card may name. A server that names one this build does not bundle draws no glyph
 * rather than pulling the whole icon set into the bundle.
 */
const ICONS: Record<string, Component> = {
  'book-open': BookOpen,
  bot: Bot,
  check: Check,
  'check-check': CheckCheck,
  download: Download,
  'file-text': FileText,
  'folder-input': FolderInput,
  'folder-search': FolderSearch,
  'folder-sync': FolderSync,
  'git-merge': GitMerge,
  inbox: Inbox,
  library: Library,
  'list-checks': ListChecks,
  mail: Mail,
  'package-open': PackageOpen,
  'rotate-cw': RotateCw,
  rss: Rss,
  search: Search,
  send: Send,
  'sliders-horizontal': SlidersHorizontal,
  sparkles: Sparkles,
  tablet: Tablet,
  tag: Tag,
  upload: Upload,
}

export function setupIcon(name: string | null | undefined): Component | null {
  return name ? (ICONS[name] ?? null) : null
}
