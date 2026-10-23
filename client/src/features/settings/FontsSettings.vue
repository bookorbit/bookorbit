<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Type, Upload, Users } from '@lucide/vue'
import { MAX_FONTS_PER_USER, MAX_SERVER_FONTS } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { useCustomFonts, type FontFamily } from '@/features/reader/epub/composables/useCustomFonts'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { formatNumber } from '@/i18n/formatters'
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

const HEADER_ACTIONS_TARGET = '#settings-header-actions'
const ACCEPT = '.ttf,.otf,.woff,.woff2'

const { t, locale } = useI18n()
const { isDemoRestrictedAccount: readonly } = usePermissions()

// One instance for both lists: hiding a server font here must show in the picker preview at once.
const customFonts = useCustomFonts()
const library = useFontLibrary('user', customFonts)
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
const byName = (list: readonly FontFamily[]) => [...list].sort((a, b) => collator.value.compare(a.name, b.name))
const matches = (family: FontFamily) => {
  const needle = query.value.trim().toLocaleLowerCase(locale.value)
  return !needle || family.name.toLocaleLowerCase(locale.value).includes(needle)
}

const ownFamilies = computed(() => byName(store.families.value))
const serverFamilies = computed(() => byName(customFonts.serverFamilies.value))
const visibleOwn = computed(() => ownFamilies.value.filter(matches))
const visibleServer = computed(() => serverFamilies.value.filter(matches))
const shownServerCount = computed(() => customFonts.visibleServerFamilies.value.length)
const totalBytes = computed(() => store.fonts.value.reduce((sum, font) => sum + font.fileSize, 0))
const hasOwnFonts = computed(() => store.fonts.value.length > 0)
/** A refetch keeps the rows on screen; only a first load with nothing to show yet says so. */
const firstLoad = computed(() => store.loading.value && !hasOwnFonts.value)
/** The list the reader's font picker offers, for the copy of it in each sheet. */
const pickerServerFamilies = computed(() => byName(customFonts.visibleServerFamilies.value))

// ── Own family sheet ───────────────────────────────────────
const sheet = useFamilySheet(library, ownFamilies)
const { openFamily, openUse, armRemove, focusName, busy: sheetBusy } = sheet

function handleOpen(name: string) {
  serverSheetName.value = null
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

// ── Server fonts: shown or hidden for this reader ─────────
const serverSheetName = ref<string | null>(null)
const serverSheetFamily = computed(() => serverFamilies.value.find((family) => family.name === serverSheetName.value) ?? null)
const pendingVisibility = ref(new Set<string>())

function isShown(family: FontFamily): boolean {
  return !customFonts.isServerFamilyHidden(family.name)
}

async function setShown(name: string, shown: boolean) {
  pendingVisibility.value = new Set([...pendingVisibility.value, name])
  try {
    const ok = await customFonts.setServerFamilyHidden(name, !shown)
    if (!ok) toast.error(t('settings.reader.fonts.serverFontVisibilityFailed'))
  } finally {
    const next = new Set(pendingVisibility.value)
    next.delete(name)
    pendingVisibility.value = next
  }
}

function openServerSheet(name: string) {
  sheet.close()
  serverSheetName.value = name
}
function closeServerSheet() {
  serverSheetName.value = null
}
function handleServerSheetShown(shown: boolean) {
  if (serverSheetName.value) void setShown(serverSheetName.value, shown)
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

useInjectedFontFaces(() => [store.fonts.value, customFonts.serverFonts.value], customFonts.generateFontFaceCSS, 'data-reader-fonts-page')

onMounted(() => {
  headerSlotAvailable.value = document.getElementById(HEADER_ACTIONS_TARGET.slice(1)) !== null
  void Promise.all([library.load(), customFonts.fetchServerFonts(), customFonts.fetchServerFontVisibility()])
})
</script>

<template>
  <div class="@container flex flex-col gap-3">
    <Teleport :to="HEADER_ACTIONS_TARGET" defer :disabled="!headerSlotAvailable">
      <Button
        v-if="!readonly"
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

    <FontUploadTray v-if="uploads.length > 0" :entries="uploads" scope="user" @dismiss="dismissUploads" />

    <FontLedgerToolbar
      v-model:query="query"
      v-model:preview-text="previewText"
      v-model:preview-size="previewSize"
      :families="ownFamilies.length"
      :files="store.fonts.value.length"
      :max-files="MAX_FONTS_PER_USER"
      :bytes="totalBytes"
    />

    <!-- Your fonts -->
    <section class="flex flex-col gap-2" data-testid="own-fonts">
      <h3 class="settings-group-label mb-0 pt-2">{{ t('settings.reader.fonts.yourFonts') }}</h3>

      <div
        v-if="firstLoad"
        class="flex items-center justify-center rounded-xl border border-border bg-card py-10 text-sm text-muted-foreground shadow-xs"
        data-testid="font-loading-surface"
      >
        {{ t('common.loading') }}
      </div>

      <div
        v-else-if="!hasOwnFonts"
        class="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-dashed border-border bg-card px-5 py-4 shadow-xs"
        data-testid="font-empty-surface"
      >
        <div class="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <Type :size="18" aria-hidden="true" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-foreground">{{ t('settings.reader.fonts.noFontsYet') }}</p>
          <p class="mt-0.5 text-xs text-muted-foreground">
            <template v-if="readonly">{{ t('settings.reader.fonts.notAvailableDemo') }}</template>
            <template v-else>{{ t('settings.reader.fonts.library.emptyHint') }} · {{ t('settings.reader.fonts.fileTypesHint') }}</template>
          </p>
        </div>
        <Button v-if="!readonly" size="sm" variant="outline" type="button" @click="openFilePicker">
          <Upload :size="14" aria-hidden="true" />
          {{ t('settings.admin.serverFonts.addFonts') }}
        </Button>
      </div>

      <template v-else>
        <FontLedgerHeader :use-label="t('settings.reader.fonts.library.columns.use')" />
        <div v-if="visibleOwn.length > 0" class="flex flex-col gap-2" data-testid="font-list-surface">
          <FontFamilyRow
            v-for="family in visibleOwn"
            :key="family.cssFamilyName"
            :family="family"
            :preview-text="sample"
            :preview-size="previewSize"
            :is-new="newFamilies.has(family.name)"
            :load-failed="failedFaces.has(family.cssFamilyName)"
            @open="handleOpen"
          >
            <template #use>
              <FontUseFacts :use="library.usageOf(family.cssFamilyName)" perspective="own" />
            </template>
            <template v-if="!readonly" #action>
              <FontFamilyMenu :name="family.name" @rename="handleRename" @add-files="openFilePicker" @remove="handleRemoveRequest" />
            </template>
          </FontFamilyRow>
        </div>
        <p v-else class="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {{ t('settings.admin.serverFonts.noMatches', { query: query.trim() }) }}
        </p>
      </template>
    </section>

    <!-- Fonts shared by the server: shown or hidden for this reader -->
    <section v-if="serverFamilies.length > 0" class="flex flex-col gap-2 pt-4" data-testid="server-fonts">
      <div class="flex items-baseline justify-between gap-3">
        <h3 class="settings-group-label mb-0">{{ t('settings.reader.fonts.serverFontsTitle') }}</h3>
        <span class="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums">{{
          t('settings.reader.fonts.serverFontsShown', { count: formatNumber(shownServerCount), total: formatNumber(serverFamilies.length) })
        }}</span>
      </div>
      <p class="text-xs text-muted-foreground">{{ t('settings.reader.fonts.serverFontsHint') }}</p>

      <FontLedgerHeader :use-label="t('settings.reader.fonts.library.columns.use')" />
      <div v-if="visibleServer.length > 0" class="flex flex-col gap-2" data-testid="server-font-list">
        <FontFamilyRow
          v-for="family in visibleServer"
          :key="family.cssFamilyName"
          :family="family"
          :preview-text="sample"
          :preview-size="previewSize"
          :muted="!isShown(family)"
          :load-failed="failedFaces.has(family.cssFamilyName)"
          @open="openServerSheet"
        >
          <template #use>
            <span
              v-if="!isShown(family)"
              class="inline-flex items-center rounded-full border border-border bg-muted px-2 text-[11.5px] leading-5 font-medium text-muted-foreground"
              >{{ t('settings.reader.fonts.library.hiddenBadge') }}</span
            >
            <FontUseFacts :use="library.usageOf(family.cssFamilyName)" perspective="own" />
          </template>
          <template #action>
            <ToggleSwitch
              :model-value="isShown(family)"
              :disabled="pendingVisibility.has(family.name)"
              :aria-label="t('settings.reader.fonts.library.showFamily', { name: family.name })"
              @update:model-value="setShown(family.name, $event)"
            />
          </template>
        </FontFamilyRow>
      </div>
      <p v-else class="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
        {{ t('settings.admin.serverFonts.noMatches', { query: query.trim() }) }}
      </p>

      <p v-if="shownServerCount === 0" class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Users :size="13" class="shrink-0" aria-hidden="true" />
        {{ t('settings.reader.fonts.serverFontsAllHidden') }}
      </p>
    </section>

    <FontDropOverlay v-if="dragCount !== null" :count="dragCount" title-key="settings.reader.fonts.library.dropTitle" />

    <FontFamilySheet
      :open="openFamily !== null"
      :family="openFamily"
      scope="user"
      perspective="own"
      :usage="openUse"
      :picker-server-families="pickerServerFamilies"
      :picker-user-families="ownFamilies"
      :total-files="store.fonts.value.length"
      :max-files="MAX_FONTS_PER_USER"
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

    <FontFamilySheet
      :open="serverSheetFamily !== null"
      :family="serverSheetFamily"
      scope="server"
      perspective="own"
      mode="view"
      :usage="library.usageOf(serverSheetFamily?.cssFamilyName ?? '')"
      :picker-server-families="pickerServerFamilies"
      :picker-user-families="ownFamilies"
      :total-files="0"
      :max-files="MAX_SERVER_FONTS"
      :readonly="false"
      :busy="false"
      :load-failed="serverSheetFamily !== null && failedFaces.has(serverSheetFamily.cssFamilyName)"
      :shown="serverSheetFamily !== null && isShown(serverSheetFamily)"
      :show-pending="serverSheetFamily !== null && pendingVisibility.has(serverSheetFamily.name)"
      @close="closeServerSheet"
      @update:shown="handleServerSheetShown"
    />
  </div>
</template>
