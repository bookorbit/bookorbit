<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Pencil, Trash2, Type, Upload, X, Check, ChevronDown, ChevronRight } from '@lucide/vue'
import type { UserFont } from '@bookorbit/types'
import type { FontScopeStore } from '@/features/reader/epub/composables/useCustomFonts'
import { formatBytes } from '@/lib/formatting'

const props = withDefaults(
  defineProps<{
    /** The collection this panel manages - per-user fonts or the server-wide set. */
    store: FontScopeStore
    /** Blocks every mutating control, e.g. for demo accounts. */
    readonly?: boolean
  }>(),
  {
    readonly: false,
  },
)

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

const isServerScope = computed(() => props.store.scope === 'server')

const listLabel = computed(() => (isServerScope.value ? t('settings.admin.serverFonts.listLabel') : t('settings.reader.fonts.yourFonts')))
const emptyTitle = computed(() => (isServerScope.value ? t('settings.admin.serverFonts.noFontsYet') : t('settings.reader.fonts.noFontsYet')))
const emptyHint = computed(() => (isServerScope.value ? t('settings.admin.serverFonts.noFontsHint') : t('settings.reader.fonts.noFontsHint')))

const fonts = computed(() => props.store.fonts.value)
const families = computed(() => props.store.families.value)

const isDragging = ref(false)
const uploadSurfaceClass = computed(() => {
  if (props.readonly) return 'cursor-not-allowed border-border bg-card opacity-50 shadow-xs'
  if (isDragging.value) return 'cursor-pointer border-primary bg-primary/5 shadow-xs'
  return 'cursor-pointer border-border bg-card shadow-xs hover:border-muted-foreground/40 hover:bg-muted/30'
})
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
  el.setAttribute('data-font-settings-preview', props.store.scope)
  el.textContent = css
  document.head.appendChild(el)
  previewStyleEl.value = el
}

function removePreviewStyles() {
  previewStyleEl.value?.remove()
  previewStyleEl.value = null
}

watch(
  fonts,
  () => {
    injectPreviewStyles(props.store.generateFontFaceCSS())
  },
  { immediate: true },
)

onMounted(() => props.store.fetchFonts())
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
  const results = await Promise.allSettled(variantsToUpdate.map((f) => props.store.updateFont(f.id, { familyName: newName })))
  const failed = results.some((r) => r.status === 'rejected' || r.value === null)
  if (failed) {
    toast.error(t('settings.reader.fonts.renameFamilyFailed'))
    await props.store.fetchFonts()
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

  const result = await props.store.updateFont(id, {
    weight: editingVariantWeight.value,
    style: editingVariantStyle.value,
  })
  if (!result) {
    toast.error(t('settings.reader.fonts.updateVariantFailed'))
    await props.store.fetchFonts()
  }
}

function handleVariantEditKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') saveEditVariant()
  else if (event.key === 'Escape') cancelEdits()
}

async function deleteVariant(font: UserFont) {
  const snapshot = [...fonts.value]
  props.store.setFonts(fonts.value.filter((f) => f.id !== font.id))

  try {
    const success = await props.store.deleteFont(font.id)
    if (!success) {
      props.store.setFonts(snapshot)
      toast.error(t('settings.reader.fonts.deleteFontFailed'))
    }
  } catch {
    props.store.setFonts(snapshot)
    toast.error(t('settings.reader.fonts.deleteFontFailed'))
  }
}

async function deleteFamily(familyName: string) {
  const variants = families.value.find((f) => f.name === familyName)?.variants ?? []
  if (variants.length === 0) return

  props.store.setFonts(fonts.value.filter((f) => f.familyName !== familyName))

  const results = await Promise.allSettled(variants.map((v) => props.store.deleteFont(v.id)))
  const failed = results.some((r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value))
  if (failed) {
    await props.store.fetchFonts()
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
  if (props.readonly) {
    toast.error(t('settings.reader.fonts.demoCannotManage'))
    return
  }
  uploadErrors.value = []
  for (const file of files) {
    try {
      await props.store.uploadFont(file)
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
    <!-- Upload zone -->
    <div class="mb-6">
      <p class="settings-group-label">{{ t('settings.reader.fonts.uploadFonts') }}</p>
      <label
        class="relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors"
        :class="uploadSurfaceClass"
        data-testid="font-upload-surface"
        @dragover="handleDragOver"
        @dragleave="handleDragLeave"
        @drop="handleDrop"
      >
        <div
          class="flex h-10 w-10 items-center justify-center rounded-full transition-colors"
          :class="isDragging && !readonly ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'"
        >
          <Upload :size="20" />
        </div>
        <div>
          <p class="text-sm font-medium text-foreground">
            <span v-if="readonly">{{ t('settings.reader.fonts.notAvailableDemo') }}</span>
            <span v-else-if="store.uploading.value">{{ t('settings.reader.fonts.uploading') }}</span>
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
          :class="readonly ? 'cursor-not-allowed' : 'cursor-pointer'"
          :disabled="store.uploading.value || readonly"
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
          <Button variant="destructive-ghost" size="icon-sm" class="mt-0.5 shrink-0" @click="dismissError(i)">
            <X :size="12" />
          </Button>
        </div>
      </div>
    </div>

    <!-- Font list -->
    <div>
      <div class="flex items-center justify-between mb-2">
        <p class="settings-group-label mb-0">{{ listLabel }}</p>
        <span class="text-xs text-muted-foreground">{{ t('settings.reader.fonts.fontsUsed', { count: fonts.length, max: store.maxFonts }) }}</span>
      </div>

      <div
        v-if="store.loading.value"
        class="flex items-center justify-center rounded-lg border border-border bg-card py-10 text-muted-foreground shadow-xs"
        data-testid="font-loading-surface"
      >
        <span class="text-sm">{{ t('common.loading') }}</span>
      </div>

      <div
        v-else-if="families.length === 0"
        class="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card px-6 py-12 text-center shadow-xs"
        data-testid="font-empty-surface"
      >
        <div class="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Type :size="22" />
        </div>
        <div>
          <p class="text-sm font-medium text-foreground">{{ emptyTitle }}</p>
          <p class="text-xs text-muted-foreground mt-1">{{ emptyHint }}</p>
        </div>
      </div>

      <div v-else class="settings-card" data-testid="font-list-surface">
        <div v-for="family in families" :key="family.name" class="bg-card">
          <!-- Family header row -->
          <div class="flex items-center gap-3 px-4 py-3">
            <button class="flex items-center gap-2 flex-1 min-w-0 text-left" @click="toggleFamily(family.name)">
              <component :is="expandedFamilies.has(family.name) ? ChevronDown : ChevronRight" :size="15" class="shrink-0 text-muted-foreground" />
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

            <span class="shrink-0 text-xs text-muted-foreground">{{ t('settings.reader.fonts.fileCount', { count: family.variants.length }) }}</span>

            <div class="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon-sm"
                v-if="editingFamilyName !== family.name && !readonly"
                :title="t('settings.reader.fonts.renameFamily')"
                @click.stop="startEditFamily(family.name)"
              >
                <Pencil :size="13" />
              </Button>
              <Button
                variant="secondary"
                size="icon-sm"
                v-if="editingFamilyName === family.name"
                :title="t('common.save')"
                @click.stop="saveEditFamily"
              >
                <Check :size="13" />
              </Button>
              <Button
                variant="destructive-ghost"
                size="icon-sm"
                v-if="!readonly"
                :title="t('settings.reader.fonts.deleteFamily')"
                @click.stop="deleteFamily(family.name)"
              >
                <Trash2 :size="13" />
              </Button>
            </div>
          </div>

          <!-- Preview line -->
          <div
            class="px-4 pb-3 -mt-1 text-sm text-muted-foreground truncate"
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
                <Button
                  variant="ghost"
                  size="icon-sm"
                  v-if="editingVariantId !== variant.id && !readonly"
                  :title="t('settings.reader.fonts.editVariant')"
                  @click="startEditVariant(variant)"
                >
                  <Pencil :size="12" />
                </Button>
                <Button variant="secondary" size="icon-sm" v-if="editingVariantId === variant.id" :title="t('common.save')" @click="saveEditVariant">
                  <Check :size="12" />
                </Button>
                <Button variant="ghost" size="icon-sm" v-if="editingVariantId === variant.id" :title="t('common.cancel')" @click="cancelEdits">
                  <X :size="12" />
                </Button>
                <Button
                  variant="destructive-ghost"
                  size="icon-sm"
                  v-if="editingVariantId !== variant.id && !readonly"
                  :title="t('settings.reader.fonts.deleteVariant')"
                  @click="deleteVariant(variant)"
                >
                  <Trash2 :size="12" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
