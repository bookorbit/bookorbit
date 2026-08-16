<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Eye, EyeOff, Loader2 } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { defaultMigrationSourceName, type MigrationSourceDraft } from '@/features/migration/lib/migration-source-config'
import { SECRET_INPUT_ATTRS } from '@/lib/secret-input'

const props = defineProps<{
  supportedTypes: string[]
  disabled: boolean
  showSecret: boolean
  testingMediaPath: boolean
  mediaPathTestState: 'idle' | 'pass' | 'fail'
  mediaPathTestMessage: string | null
  mediaRootPathHint: { className: string; text: string }
  wide?: boolean
}>()

const draft = defineModel<MigrationSourceDraft>('draft', { required: true })

const emit = defineEmits<{
  toggleSecret: []
  testMediaPath: []
}>()

const { t } = useI18n()

const isAudiobookshelf = computed(() => draft.value.type === 'audiobookshelf')
const isCalibreWebAutomated = computed(() => draft.value.type === 'calibre_web_automated')
const gridClass = computed(() => (props.wide ? 'md:grid-cols-2 xl:grid-cols-4' : 'md:grid-cols-2'))
const secretToggleLabel = computed(() => (props.showSecret ? t('migration.source.fields.hideSecret') : t('migration.source.fields.showSecret')))
const sourceTypeKeys: Record<string, string> = {
  booklore: 'migration.source.types.booklore',
  grimmory: 'migration.source.types.grimmory',
  audiobookshelf: 'migration.source.types.audiobookshelf',
  calibre_web_automated: 'migration.source.types.calibreWebAutomated',
}

watch(
  () => draft.value.type,
  (type, previousType) => {
    if (!draft.value.name.trim() || draft.value.name === defaultMigrationSourceName(previousType)) {
      draft.value.name = defaultMigrationSourceName(type)
    }
  },
)

function handleToggleSecret() {
  emit('toggleSecret')
}

function handleTestMediaPath() {
  emit('testMediaPath')
}

function sourceTypeLabel(type: string): string {
  const key = sourceTypeKeys[type]
  return key ? t(key) : type
}
</script>

<template>
  <div class="grid gap-2" :class="gridClass" data-testid="migration-source-fields">
    <label class="block">
      <span class="settings-hint">{{ t('migration.source.fields.type') }}</span>
      <select v-model="draft.type" class="select-field mt-1 w-full" :disabled="disabled">
        <option v-for="type in supportedTypes" :key="type" :value="type">{{ sourceTypeLabel(type) }}</option>
      </select>
    </label>

    <label class="block">
      <span class="settings-hint">{{ t('migration.source.fields.name') }}</span>
      <input v-model="draft.name" class="input-field mt-1 w-full" :placeholder="t('migration.source.fields.namePlaceholder')" :disabled="disabled" />
    </label>

    <template v-if="isCalibreWebAutomated">
      <section
        id="cwa-snapshot-guidance"
        class="space-y-2 rounded-md border border-primary/30 bg-primary/10 p-3 text-sm"
        :class="wide ? 'md:col-span-2 xl:col-span-4' : 'md:col-span-2'"
        aria-labelledby="cwa-snapshot-guidance-title"
      >
        <h3 id="cwa-snapshot-guidance-title" class="font-medium text-foreground">
          {{ t('migration.source.cwa.snapshotTitle') }}
        </h3>
        <p class="font-medium text-foreground">{{ t('migration.source.cwa.stoppedWarning') }}</p>
        <p class="text-muted-foreground">{{ t('migration.source.cwa.importRootGuidance') }}</p>
        <p class="text-muted-foreground">{{ t('migration.source.cwa.logicalRootGuidance') }}</p>
        <p class="text-muted-foreground">{{ t('migration.source.cwa.compatibilityNote') }}</p>
      </section>

      <label class="block md:col-span-2">
        <span class="settings-hint">{{ t('migration.source.fields.cwaAppDatabasePath') }}</span>
        <input
          v-model="draft.cwaAppDatabasePath"
          class="input-field mt-1 w-full"
          :placeholder="t('migration.source.fields.cwaAppDatabasePathPlaceholder')"
          aria-describedby="cwa-snapshot-guidance"
          :disabled="disabled"
        />
      </label>

      <label class="block md:col-span-2">
        <span class="settings-hint">{{ t('migration.source.fields.cwaMetadataDatabasePath') }}</span>
        <input
          v-model="draft.cwaMetadataDatabasePath"
          class="input-field mt-1 w-full"
          :placeholder="t('migration.source.fields.cwaMetadataDatabasePathPlaceholder')"
          aria-describedby="cwa-snapshot-guidance"
          :disabled="disabled"
        />
      </label>
    </template>

    <template v-else-if="isAudiobookshelf">
      <fieldset class="min-w-0" :class="wide ? 'md:col-span-2 xl:col-span-2' : 'md:col-span-2'">
        <legend class="settings-hint">{{ t('migration.source.fields.connectionMode') }}</legend>
        <div class="mt-1 flex min-h-9 flex-wrap items-center gap-x-5 gap-y-2">
          <label class="flex cursor-pointer items-center gap-2">
            <input v-model="draft.audiobookshelfMode" type="radio" value="api" class="size-4 border-border" :disabled="disabled" />
            <span class="text-sm text-foreground">{{ t('migration.source.fields.apiMode') }}</span>
          </label>
          <label class="flex cursor-pointer items-center gap-2">
            <input v-model="draft.audiobookshelfMode" type="radio" value="backup" class="size-4 border-border" :disabled="disabled" />
            <span class="text-sm text-foreground">{{ t('migration.source.fields.backupMode') }}</span>
          </label>
        </div>
      </fieldset>

      <template v-if="draft.audiobookshelfMode === 'api'">
        <label class="block" :class="wide ? 'md:col-span-2' : ''">
          <span class="settings-hint">{{ t('migration.source.fields.baseUrl') }}</span>
          <input
            v-model="draft.baseUrl"
            class="input-field mt-1 w-full"
            type="url"
            inputmode="url"
            placeholder="http://audiobookshelf.local:13378"
            :disabled="disabled"
          />
        </label>
        <label class="block" :class="wide ? 'md:col-span-2' : ''">
          <span class="settings-hint">{{ t('migration.source.fields.apiToken') }}</span>
          <div class="relative mt-1">
            <input
              v-model="draft.apiToken"
              v-bind="SECRET_INPUT_ATTRS"
              class="input-field w-full pe-10"
              :class="{ 'input-secret': !showSecret }"
              type="text"
              :placeholder="
                draft.apiToken === '********' ? t('migration.source.fields.secretSaved') : t('migration.source.fields.apiTokenPlaceholder')
              "
              :disabled="disabled"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              type="button"
              class="absolute inset-y-0 end-0"
              :aria-label="secretToggleLabel"
              :disabled="disabled"
              @click="handleToggleSecret"
            >
              <EyeOff v-if="showSecret" class="size-4" aria-hidden="true" />
              <Eye v-else class="size-4" aria-hidden="true" />
            </Button>
          </div>
        </label>
        <div class="flex items-center" :class="wide ? 'md:col-span-2 xl:col-span-4' : 'md:col-span-2'">
          <label class="flex min-h-9 cursor-pointer items-center gap-2">
            <input v-model="draft.allowPrivateNetwork" type="checkbox" class="size-4 rounded border-border" :disabled="disabled" />
            <span class="settings-hint">{{ t('migration.source.fields.allowPrivateNetwork') }}</span>
          </label>
        </div>
        <p class="text-xs text-muted-foreground" :class="wide ? 'md:col-span-2 xl:col-span-4' : 'md:col-span-2'">
          {{ t('migration.source.fields.allowPrivateNetworkHint') }}
        </p>
      </template>

      <label v-else class="block" :class="wide ? 'md:col-span-2 xl:col-span-4' : 'md:col-span-2'">
        <span class="settings-hint">{{ t('migration.source.fields.backupPath') }}</span>
        <input
          v-model="draft.backupPath"
          class="input-field mt-1 w-full"
          placeholder="/imports/audiobookshelf/backup.audiobookshelf"
          :disabled="disabled"
        />
        <span class="mt-1 block text-xs text-muted-foreground">{{ t('migration.source.fields.backupPathHint') }}</span>
      </label>
    </template>

    <template v-else>
      <label class="block">
        <span class="settings-hint">{{ t('migration.source.fields.host') }}</span>
        <input v-model="draft.host" class="input-field mt-1 w-full" placeholder="127.0.0.1" :disabled="disabled" />
      </label>
      <label class="block">
        <span class="settings-hint">{{ t('migration.source.fields.port') }}</span>
        <input v-model.number="draft.port" class="input-field mt-1 w-full" type="number" min="1" max="65535" :disabled="disabled" />
      </label>
      <label class="block">
        <span class="settings-hint">{{ t('migration.source.fields.user') }}</span>
        <input v-model="draft.user" class="input-field mt-1 w-full" placeholder="booklore" :disabled="disabled" />
      </label>
      <label class="block">
        <span class="settings-hint">{{ t('migration.source.fields.password') }}</span>
        <div class="relative mt-1">
          <input
            v-model="draft.password"
            v-bind="SECRET_INPUT_ATTRS"
            class="input-field w-full pe-10"
            :class="{ 'input-secret': !showSecret }"
            type="text"
            :placeholder="draft.password === '********' ? t('migration.source.fields.passwordSaved') : t('migration.source.fields.passwordNotSet')"
            :disabled="disabled"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            class="absolute inset-y-0 end-0"
            :aria-label="secretToggleLabel"
            :disabled="disabled"
            @click="handleToggleSecret"
          >
            <EyeOff v-if="showSecret" class="size-4" aria-hidden="true" />
            <Eye v-else class="size-4" aria-hidden="true" />
          </Button>
        </div>
      </label>
      <label class="block">
        <span class="settings-hint">{{ t('migration.source.fields.database') }}</span>
        <input v-model="draft.database" class="input-field mt-1 w-full" placeholder="booklore" :disabled="disabled" />
      </label>
      <label class="block" :class="wide ? 'md:col-span-2 xl:col-span-2' : ''">
        <span class="settings-hint">{{ t('migration.source.fields.mediaRootPath') }}</span>
        <div class="mt-1 flex items-center gap-2">
          <input v-model="draft.mediaRootPath" class="input-field w-full" placeholder="/data/booklore/media" :disabled="disabled" />
          <button
            type="button"
            :disabled="testingMediaPath || disabled"
            class="inline-flex h-9 items-center rounded-md border px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            :class="
              mediaPathTestState === 'pass'
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20'
                : mediaPathTestState === 'fail'
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20'
                  : 'border-border bg-background text-foreground hover:bg-muted'
            "
            @click="handleTestMediaPath"
          >
            <Loader2 v-if="testingMediaPath" class="size-3.5 animate-spin" aria-hidden="true" />
            <span v-else>
              {{
                mediaPathTestState === 'pass'
                  ? t('migration.source.mediaPath.buttonOk')
                  : mediaPathTestState === 'fail'
                    ? t('migration.source.mediaPath.buttonIssue')
                    : t('migration.source.mediaPath.buttonTest')
              }}
            </span>
          </button>
        </div>
        <p class="mt-1 text-xs" :class="mediaRootPathHint.className">{{ mediaRootPathHint.text }}</p>
        <p v-if="mediaPathTestMessage" class="mt-1 text-xs" :class="mediaPathTestState === 'pass' ? 'text-emerald-700' : 'text-amber-700'">
          {{ mediaPathTestMessage }}
        </p>
      </label>
      <div class="flex items-center">
        <label class="flex min-h-9 cursor-pointer items-center gap-2">
          <input v-model="draft.ssl" type="checkbox" class="size-4 rounded border-border" :disabled="disabled" />
          <span class="settings-hint">{{ t('migration.source.fields.ssl') }}</span>
        </label>
      </div>
    </template>
  </div>
</template>
