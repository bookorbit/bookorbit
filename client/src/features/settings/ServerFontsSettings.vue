<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Info, Type, Upload } from '@lucide/vue'
import { MAX_SERVER_FONTS } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import SettingsPageHeader from './SettingsPageHeader.vue'
import FontDropOverlay from './fonts/components/FontDropOverlay.vue'
import FontFamilyMenu from './fonts/components/FontFamilyMenu.vue'
import FontFamilyRow from './fonts/components/FontFamilyRow.vue'
import FontFamilySheet from './fonts/components/FontFamilySheet.vue'
import FontLedgerHeader from './fonts/components/FontLedgerHeader.vue'
import FontLedgerToolbar from './fonts/components/FontLedgerToolbar.vue'
import FontUploadTray from './fonts/components/FontUploadTray.vue'
import FontUseFacts from './fonts/components/FontUseFacts.vue'
import { useFailedFontFaces } from './fonts/composables/useFailedFontFaces'
import { useFamilySheet } from './fonts/composables/useFamilySheet'
import { useFontDropTarget } from './fonts/composables/useFontDropTarget'
import { useFontLibrary } from './fonts/composables/useFontLibrary'
import { useInjectedFontFaces } from './fonts/composables/useInjectedFontFaces'
import { DEFAULT_PREVIEW_SIZE } from './fonts/lib/preview-sizes'

withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const HEADER_ACTIONS_TARGET = '#settings-header-actions'
const ACCEPT = '.ttf,.otf,.woff,.woff2'

const { t, locale } = useI18n()
const { isDemoRestrictedAccount: readonly } = usePermissions()
const library = useFontLibrary('server')
const { store, uploads, newFamilies } = library
const { failed: failedFaces } = useFailedFontFaces()

/**
 * The header renders the primary action beside the title. Falling back to rendering in place keeps
 * it reachable when this page is mounted outside the settings shell, including in tests.
 */
const headerSlotAvailable = ref(false)

const query = ref('')
const previewText = ref('')
const previewSize = ref(DEFAULT_PREVIEW_SIZE)
const sample = computed(() => previewText.value.trim() || t('settings.reader.fonts.pangram'))

const collator = computed(() => new Intl.Collator(locale.value, { sensitivity: 'base', numeric: true }))
const families = computed(() => [...store.families.value].sort((a, b) => collator.value.compare(a.name, b.name)))
const visibleFamilies = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase(locale.value)
  return needle ? families.value.filter((family) => family.name.toLocaleLowerCase(locale.value).includes(needle)) : families.value
})
const totalBytes = computed(() => store.fonts.value.reduce((sum, font) => sum + font.fileSize, 0))
const hasFonts = computed(() => store.fonts.value.length > 0)
/** A refetch keeps the rows on screen; only a first load with nothing to show yet says so. */
const firstLoad = computed(() => store.loading.value && !hasFonts.value)

const sheet = useFamilySheet(library, families)
const { openFamily, openUse, armRemove, focusName, busy: sheetBusy } = sheet

function handleOpen(name: string) {
  sheet.open(name)
}
function handleRename(name: string) {
  sheet.open(name, { rename: true })
}
function handleRemoveRequest(name: string) {
  sheet.open(name, { remove: true })
}
function closeSheet() {
  sheet.close()
}
function saveRename(newName: string) {
  void sheet.rename(newName)
}
function removeOpenFamily() {
  void sheet.removeFamily()
}
function updateFile(fontId: number, data: { weight: number; style: 'normal' | 'italic' }) {
  void sheet.updateFile(fontId, data)
}
function removeFile(fontId: number) {
  void sheet.removeFile(fontId)
}

// ── Uploads ────────────────────────────────────────────────
const fileInput = ref<HTMLInputElement | null>(null)

function openFilePicker() {
  if (readonly.value) {
    toast.error(t('settings.reader.fonts.demoCannotManage'))
    return
  }
  fileInput.value?.click()
}

function handleFileInput(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  void library.addFiles(files)
}

function dismissUploads() {
  library.dismissUploads()
}

const { dragCount } = useFontDropTarget(
  () => !readonly.value,
  (files) => void library.addFiles(files),
)

useInjectedFontFaces(() => store.fonts.value, store.generateFontFaceCSS, 'data-server-fonts-page')

onMounted(() => {
  headerSlotAvailable.value = document.getElementById(HEADER_ACTIONS_TARGET.slice(1)) !== null
  void library.load()
})
</script>

<template>
  <div class="@container flex flex-col gap-3">
    <SettingsPageHeader v-if="!embedded" :title="t('settings.admin.serverFonts.title')" :subtitle="t('settings.admin.serverFonts.subtitle')" />

    <Teleport :to="HEADER_ACTIONS_TARGET" defer :disabled="!headerSlotAvailable">
      <Button
        v-if="!readonly && hasFonts"
        size="sm"
        type="button"
        class="max-sm:size-8 max-sm:p-0"
        :aria-label="t('settings.admin.serverFonts.addFonts')"
        @click="openFilePicker"
      >
        <Upload :size="14" aria-hidden="true" />
        <span class="max-sm:sr-only">{{ t('settings.admin.serverFonts.addFonts') }}</span>
      </Button>
    </Teleport>

    <input
      ref="fileInput"
      type="file"
      :accept="ACCEPT"
      multiple
      class="sr-only"
      tabindex="-1"
      aria-hidden="true"
      data-testid="font-file-input"
      @change="handleFileInput"
    />

    <FontUploadTray v-if="uploads.length > 0" :entries="uploads" @dismiss="dismissUploads" />

    <div
      v-if="firstLoad"
      class="flex items-center justify-center rounded-xl border border-border bg-card py-10 text-sm text-muted-foreground shadow-xs"
      data-testid="font-loading-surface"
    >
      {{ t('common.loading') }}
    </div>

    <div
      v-else-if="!hasFonts"
      class="mx-auto mt-6 flex w-full max-w-[40rem] flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center shadow-xs"
      data-testid="font-empty-surface"
    >
      <div class="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
        <Type :size="22" aria-hidden="true" />
      </div>
      <div>
        <p class="text-sm font-medium text-foreground">{{ t('settings.admin.serverFonts.noFontsYet') }}</p>
        <p class="mt-1 text-xs text-muted-foreground">{{ t('settings.admin.serverFonts.noFontsHint') }}</p>
      </div>
      <template v-if="!readonly">
        <Button size="sm" type="button" @click="openFilePicker">
          <Upload :size="14" aria-hidden="true" />
          {{ t('settings.admin.serverFonts.addFonts') }}
        </Button>
        <p class="text-xs text-muted-foreground">
          {{ t('settings.admin.serverFonts.empty.dropHint') }} · {{ t('settings.reader.fonts.fileTypesHint') }}
        </p>
      </template>
      <p
        class="mt-2 flex max-w-md items-start gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-start text-[12.5px] leading-[18px] text-muted-foreground"
      >
        <Info :size="14" class="mt-0.5 shrink-0" aria-hidden="true" />
        {{ t('settings.admin.serverFonts.empty.tip') }}
      </p>
    </div>

    <template v-else>
      <FontLedgerToolbar
        v-model:query="query"
        v-model:preview-text="previewText"
        v-model:preview-size="previewSize"
        :families="families.length"
        :files="store.fonts.value.length"
        :max-files="MAX_SERVER_FONTS"
        :bytes="totalBytes"
      />

      <FontLedgerHeader :use-label="t('settings.admin.serverFonts.columns.readers')" />

      <div v-if="visibleFamilies.length > 0" class="flex flex-col gap-2" data-testid="font-list-surface">
        <FontFamilyRow
          v-for="family in visibleFamilies"
          :key="family.cssFamilyName"
          :family="family"
          :preview-text="sample"
          :preview-size="previewSize"
          :is-new="newFamilies.has(family.name)"
          :load-failed="failedFaces.has(family.cssFamilyName)"
          @open="handleOpen"
        >
          <template #use>
            <FontUseFacts :use="library.usageOf(family.cssFamilyName)" perspective="server" />
          </template>
          <template v-if="!readonly" #action>
            <FontFamilyMenu :name="family.name" @rename="handleRename" @add-files="openFilePicker" @remove="handleRemoveRequest" />
          </template>
        </FontFamilyRow>
      </div>
      <p v-else class="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
        {{ t('settings.admin.serverFonts.noMatches', { query: query.trim() }) }}
      </p>

      <p class="px-1 pt-1 text-xs text-muted-foreground">{{ t('settings.admin.serverFonts.footerHint') }}</p>
    </template>

    <FontDropOverlay v-if="dragCount !== null" :count="dragCount" title-key="settings.admin.serverFonts.drop.title" />

    <FontFamilySheet
      :open="openFamily !== null"
      :family="openFamily"
      scope="server"
      perspective="server"
      :usage="openUse"
      :picker-server-families="families"
      :total-files="store.fonts.value.length"
      :max-files="MAX_SERVER_FONTS"
      :readonly="readonly"
      :busy="sheetBusy"
      :arm-remove="armRemove"
      :focus-name="focusName"
      :load-failed="openFamily !== null && failedFaces.has(openFamily.cssFamilyName)"
      @close="closeSheet"
      @save="saveRename"
      @remove="removeOpenFamily"
      @add-files="openFilePicker"
      @update-file="updateFile"
      @remove-file="removeFile"
    />
  </div>
</template>
