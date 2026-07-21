<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Pencil, Trash2, Upload, X, Check, ChevronDown, ChevronRight } from '@lucide/vue'
import { MAX_FONTS_PER_USER } from '@bookorbit/types'
import type { UserFont } from '@bookorbit/types'
import { useCustomFonts } from '@/features/reader/epub/composables/useCustomFonts'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import SettingsPageHeader from './SettingsPageHeader.vue'
import { formatBytes } from '@/lib/formatting'

const { t } = useI18n()

const WEIGHT_LABELS = computed<Record<number, string>>(() => ({
  100: t('settings.reader.fonts.weightThin'),
  200: t('settings.reader.fonts.weightExtraLight'),
  300: t('settings.reader.fonts.weightLight'),
  400: t('settings.reader.fonts.weightRegular'),
  500: t('settings.reader.fonts.weightMedium'),
  600: t('settings.reader.fonts.weightSemiBold'),
  700: t('settings.reader.fonts.weightBold'),
  800: t('settings.reader.fonts.weightExtraBold'),
  900: t('settings.reader.fonts.weightBlack'),
}))

const customFonts = useCustomFonts()
const { fonts, families, loading, uploading, fetchFonts, uploadFont, updateFont } = customFonts
const { isDemoRestrictedAccount } = usePermissions()

const isDragging = ref(false)
const uploadErrors = ref<string[]>([])
const expandedFamilies = ref<Set<string>>(new Set())
const editingFamilyName = ref<string | null>(null)
const editingFamilyValue = ref('')
const editingVariantId = ref<number | null>(null)
const editingVariantWeight = ref<number>(400)
const editingVariantStyle = ref<'normal' | 'italic'>('normal')

const previewStyleEl = ref<HTMLStyleElement | null>(null)

function injectPreviewStyles(css: string) {
  if (previewStyleEl.value) {
    previewStyleEl.value.textContent = css
    return
  }
  if (!css) return
  const el = document.createElement('style')
  el.setAttribute('data-font-settings-preview', '')
  el.textContent = css
  document.head.appendChild(el)
  previewStyleEl.value = el
}

function removePreviewStyles() {
  previewStyleEl.value?.remove()
  previewStyleEl.value = null
}

watch(
  () => fonts.value,
  () => {
    injectPreviewStyles(customFonts.generateFontFaceCSS())
  },
  { immediate: true },
)

onMounted(fetchFonts)
onUnmounted(removePreviewStyles)

function toggleFamily(name: string) {
  if (expandedFamilies.value.has(name)) {
    expandedFamilies.value.delete(name)
  } else {
    expandedFamilies.value.add(name)
  }
}

function startEditFamily(familyName: string) {
  cancelEdits()
  editingFamilyName.value = familyName
  editingFamilyValue.value = familyName
}

function cancelEdits() {
  editingFamilyName.value = null
  editingVariantId.value = null
}

async function saveEditFamily() {
  const oldName = editingFamilyName.value
  const newName = editingFamilyValue.value.trim()
  editingFamilyName.value = null
  if (!oldName || !newName || newName === oldName) return

  const variantsToUpdate = fonts.value.filter((f) => f.familyName === oldName)
  const results = await Promise.allSettled(variantsToUpdate.map((f) => updateFont(f.id, { familyName: newName })))
  const failed = results.some((r) => r.status === 'rejected' || r.value === null)
  if (failed) {
    toast.error(t('settings.reader.fonts.renameFamilyFailed'))
    await fetchFonts()
  } else {
    toast.success(t('settings.reader.fonts.renamedTo', { name: newName }))
  }
}

function handleFamilyEditKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') saveEditFamily()
  else if (event.key === 'Escape') cancelEdits()
}

function startEditVariant(font: UserFont) {
  cancelEdits()
  editingVariantId.value = font.id
  editingVariantWeight.value = font.weight
  editingVariantStyle.value = font.style
}

async function saveEditVariant() {
  const id = editingVariantId.value
  editingVariantId.value = null
  if (!id) return

  const result = await updateFont(id, {
    weight: editingVariantWeight.value,
    style: editingVariantStyle.value,
  })
  if (!result) {
    toast.error(t('settings.reader.fonts.updateVariantFailed'))
    await fetchFonts()
  }
}

function handleVariantEditKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') saveEditVariant()
  else if (event.key === 'Escape') cancelEdits()
}

async function deleteVariant(font: UserFont) {
  const snapshot = [...fonts.value]
  fonts.value = fonts.value.filter((f) => f.id !== font.id)

  try {
    const success = await customFonts.deleteFont(font.id)
    if (!success) {
      fonts.value = snapshot
      toast.error(t('settings.reader.fonts.deleteFontFailed'))
    }
  } catch {
    fonts.value = snapshot
    toast.error(t('settings.reader.fonts.deleteFontFailed'))
  }
}

async function deleteFamily(familyName: string) {
  const variants = families.value.find((f) => f.name === familyName)?.variants ?? []
  if (variants.length === 0) return

  fonts.value = fonts.value.filter((f) => f.familyName !== familyName)

  const results = await Promise.allSettled(variants.map((v) => customFonts.deleteFont(v.id)))
  const failed = results.some((r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value))
  if (failed) {
    await fetchFonts()
    toast.error(t('settings.reader.fonts.deleteFamilyFailed'))
  }
}

function handleDragOver(event: DragEvent) {
  event.preventDefault()
  isDragging.value = true
}

function handleDragLeave() {
  isDragging.value = false
}

function handleDrop(event: DragEvent) {
  event.preventDefault()
  isDragging.value = false
  const files = Array.from(event.dataTransfer?.files ?? [])
  processFiles(files)
}

function handleFileInput(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  processFiles(files)
}

async function processFiles(files: File[]) {
  if (isDemoRestrictedAccount.value) {
    toast.error(t('settings.reader.fonts.demoCannotManage'))
    return
  }
  uploadErrors.value = []
  for (const file of files) {
    try {
      await uploadFont(file)
      toast.success(t('settings.reader.fonts.fileAdded', { name: file.name }))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('settings.reader.fonts.uploadFailed')
      uploadErrors.value = [...uploadErrors.value, `${file.name}: ${message}`]
    }
  }
}

function dismissError(index: number) {
  uploadErrors.value = uploadErrors.value.filter((_, i) => i !== index)
}
</script>

<template>
  <div>
    <SettingsPageHeader :title="t('settings.reader.fonts.title')" :subtitle="t('settings.reader.fonts.subtitle')" />

    <!-- Upload zone -->
    <div class="mb-6">
      <p class="settings-group-label">{{ t('settings.reader.fonts.uploadFonts') }}</p>
      <label
        class="relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors"
        :class="[
          isDemoRestrictedAccount ? 'border-border opacity-50 cursor-not-allowed' : 'cursor-pointer',
          !isDemoRestrictedAccount &&
            (isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/40 hover:bg-muted/30'),
        ]"
        @dragover="handleDragOver"
        @dragleave="handleDragLeave"
        @drop="handleDrop"
      >
        <div
          class="flex h-10 w-10 items-center justify-center rounded-full transition-colors"
          :class="isDragging && !isDemoRestrictedAccount ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'"
        >
          <Upload :size="20" />
        </div>
        <div>
          <p class="text-sm font-medium text-foreground">
            <span v-if="isDemoRestrictedAccount">{{ t('settings.reader.fonts.notAvailableDemo') }}</span>
            <span v-else-if="uploading">{{ t('settings.reader.fonts.uploading') }}</span>
            <span v-else-if="isDragging">{{ t('settings.reader.fonts.dropFilesHere') }}</span>
            <span v-else
              >{{ t('settings.reader.fonts.dragFontsPrefix') }}
              <span class="text-primary underline underline-offset-2">{{ t('settings.reader.fonts.browse') }}</span></span
            >
          </p>
          <p class="mt-1 text-xs text-muted-foreground">{{ t('settings.reader.fonts.fileTypesHint') }}</p>
        </div>
        <input
          type="file"
          accept=".ttf,.otf,.woff,.woff2"
          multiple
          class="absolute inset-0 opacity-0"
          :class="isDemoRestrictedAccount ? 'cursor-not-allowed' : 'cursor-pointer'"
          :disabled="uploading || isDemoRestrictedAccount"
          @change="handleFileInput"
        />
      </label>

      <div v-if="uploadErrors.length > 0" class="mt-2 space-y-1">
        <div
          v-for="(err, i) in uploadErrors"
          :key="i"
          class="flex items-start justify-between gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          <span>{{ err }}</span>
          <button class="mt-0.5 shrink-0 hover:opacity-70" @click="dismissError(i)">
            <X :size="12" />
          </button>
        </div>
      </div>
    </div>

    <!-- Font list -->
    <div>
      <div class="flex items-center justify-between mb-2">
        <p class="settings-group-label mb-0">{{ t('settings.reader.fonts.yourFonts') }}</p>
        <span class="text-xs text-muted-foreground">{{
          t('settings.reader.fonts.fontsUsed', { count: fonts.length, max: MAX_FONTS_PER_USER })
        }}</span>
      </div>

      <div v-if="loading" class="flex items-center justify-center py-10 text-muted-foreground">
        <span class="text-sm">{{ t('common.loading') }}</span>
      </div>

      <div
        v-else-if="families.length === 0"
        class="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-12 text-center"
      >
        <div class="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Upload :size="22" />
        </div>
        <div>
          <p class="text-sm font-medium text-foreground">{{ t('settings.reader.fonts.noFontsYet') }}</p>
          <p class="text-xs text-muted-foreground mt-1">{{ t('settings.reader.fonts.noFontsHint') }}</p>
        </div>
      </div>

      <div v-else class="border border-border rounded-lg overflow-hidden divide-y divide-border">
        <div v-for="family in families" :key="family.name" class="bg-card">
          <!-- Family header row -->
          <div class="flex items-center gap-3 px-4 py-3">
            <button class="flex items-center gap-2 flex-1 min-w-0 text-left" @click="toggleFamily(family.name)">
              <component :is="expandedFamilies.has(family.name) ? ChevronDown : ChevronRight" :size="15" class="shrink-0 text-muted-foreground" />
              <template v-if="editingFamilyName === family.name">
                <!-- inline edit input — stop click propagation so toggle doesn't fire -->
              </template>
              <span
                v-if="editingFamilyName !== family.name"
                class="text-sm font-medium truncate"
                :style="{ fontFamily: `'${family.cssFamilyName}', sans-serif` }"
              >
                {{ family.name }}
              </span>
            </button>

            <input
              v-if="editingFamilyName === family.name"
              v-model="editingFamilyValue"
              class="flex-1 min-w-0 rounded-md border border-primary bg-background px-2 py-0.5 text-sm font-medium focus:outline-none"
              autofocus
              @blur="saveEditFamily"
              @keydown="handleFamilyEditKeydown"
              @click.stop
            />

            <span class="shrink-0 text-xs text-muted-foreground">{{
              t('settings.reader.fonts.fileCount', { count: family.variants.length }, family.variants.length)
            }}</span>

            <div class="flex items-center gap-1 shrink-0">
              <button
                v-if="editingFamilyName !== family.name && !isDemoRestrictedAccount"
                class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                :title="t('settings.reader.fonts.renameFamily')"
                @click.stop="startEditFamily(family.name)"
              >
                <Pencil :size="13" />
              </button>
              <button
                v-if="editingFamilyName === family.name"
                class="flex h-7 w-7 items-center justify-center rounded-md text-primary transition-colors hover:bg-primary/10"
                :title="t('common.save')"
                @click.stop="saveEditFamily"
              >
                <Check :size="13" />
              </button>
              <button
                v-if="!isDemoRestrictedAccount"
                class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                :title="t('settings.reader.fonts.deleteFamily')"
                @click.stop="deleteFamily(family.name)"
              >
                <Trash2 :size="13" />
              </button>
            </div>
          </div>

          <!-- Preview line -->
          <div
            class="px-4 pb-3 -mt-1 text-sm text-muted-foreground/90 truncate"
            :style="{ fontFamily: `'${family.cssFamilyName}', sans-serif`, fontSize: '16px' }"
          >
            {{ t('settings.reader.fonts.pangram') }}
          </div>

          <!-- Variant rows (expanded) -->
          <div v-if="expandedFamilies.has(family.name)" class="border-t border-border/60 divide-y divide-border/60 bg-muted/20">
            <div v-for="variant in family.variants" :key="variant.id" class="flex items-center gap-3 px-5 py-2.5">
              <div class="flex-1 min-w-0">
                <template v-if="editingVariantId === variant.id">
                  <div class="flex items-center gap-2 flex-wrap">
                    <select
                      v-model="editingVariantWeight"
                      class="h-7 rounded border border-border bg-background px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                      @keydown="handleVariantEditKeydown"
                    >
                      <option v-for="(label, w) in WEIGHT_LABELS" :key="w" :value="Number(w)">{{ label }} ({{ w }})</option>
                    </select>
                    <select
                      v-model="editingVariantStyle"
                      class="h-7 rounded border border-border bg-background px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                      @keydown="handleVariantEditKeydown"
                    >
                      <option value="normal">{{ t('settings.reader.fonts.styleNormal') }}</option>
                      <option value="italic">{{ t('settings.reader.fonts.styleItalic') }}</option>
                    </select>
                  </div>
                </template>
                <template v-else>
                  <span class="text-xs text-foreground">
                    {{ WEIGHT_LABELS[variant.weight] ?? variant.weight }}
                    {{ variant.style === 'italic' ? '· ' + t('settings.reader.fonts.styleItalic') : '' }}
                  </span>
                  <span class="ml-2 text-xs text-muted-foreground uppercase">{{ variant.format }}</span>
                  <span class="ml-2 text-xs text-muted-foreground">{{ formatBytes(variant.fileSize) }}</span>
                </template>
              </div>

              <div class="flex items-center gap-1 shrink-0">
                <button
                  v-if="editingVariantId !== variant.id && !isDemoRestrictedAccount"
                  class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  :title="t('settings.reader.fonts.editVariant')"
                  @click="startEditVariant(variant)"
                >
                  <Pencil :size="12" />
                </button>
                <button
                  v-if="editingVariantId === variant.id"
                  class="flex h-6 w-6 items-center justify-center rounded text-primary transition-colors hover:bg-primary/10"
                  :title="t('common.save')"
                  @click="saveEditVariant"
                >
                  <Check :size="12" />
                </button>
                <button
                  v-if="editingVariantId === variant.id"
                  class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted"
                  :title="t('common.cancel')"
                  @click="cancelEdits"
                >
                  <X :size="12" />
                </button>
                <button
                  v-if="editingVariantId !== variant.id && !isDemoRestrictedAccount"
                  class="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  :title="t('settings.reader.fonts.deleteVariant')"
                  @click="deleteVariant(variant)"
                >
                  <Trash2 :size="12" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
