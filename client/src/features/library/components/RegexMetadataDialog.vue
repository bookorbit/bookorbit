<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { ArrowDown, ArrowUp, Plus, Trash2 } from '@lucide/vue'
import { REGEX_METADATA_GROUPS, REGEX_METADATA_LIMITS, type RegexMetadataConfig } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useRegexMetadataEditor } from '../composables/useRegexMetadataEditor'

const props = defineProps<{ config: RegexMetadataConfig | null; libraryId?: number }>()
const emit = defineEmits<{ close: []; apply: [config: RegexMetadataConfig | null] }>()
const { t } = useI18n()
const {
  validation,
  validating,
  validationError,
  ruleErrors,
  patternInvalid,
  flagsInvalid,
  generalDiagnostics,
  validRuleCount,
  validateRules,
  enabled,
  rules,
  relativePath,
  result,
  busy,
  error,
  canApply,
  canPreview,
  addRule,
  removeRule,
  moveUp,
  moveDown,
  value,
  preview,
} = useRegexMetadataEditor(props.config, props.libraryId)
const examplePattern = String.raw`(?<author>[^\/]+)\/(?<series>[^\/]+)\/(?<seriesIndex>\d+) - (?<title>.+) - \k<author>`
const examplePath = 'Donna Leon/Commissario Brunetti/01 - Venezianisches Finale - Donna Leon.epub'

function close() {
  emit('close')
}
function handleOpenChange(open: boolean) {
  if (!open) close()
}
function apply() {
  if (canApply.value) emit('apply', value())
}
</script>

<template>
  <DialogRoot :open="true" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[70] bg-scrim" />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-[70] flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-xl"
      >
        <DialogTitle class="text-lg font-semibold">{{ t('library.creator.metadata.regex.title') }}</DialogTitle>
        <DialogDescription class="text-sm text-muted-foreground">{{ t('library.creator.metadata.regex.description') }}</DialogDescription>
        <label class="flex items-center gap-2 text-sm font-medium">
          <input v-model="enabled" type="checkbox" class="accent-primary" />
          {{ t('library.creator.metadata.regex.enable') }}
        </label>
        <p class="text-xs text-muted-foreground">
          {{ t('library.creator.metadata.regex.groups') }} <code>{{ REGEX_METADATA_GROUPS.join(', ') }}</code>
        </p>
        <p class="text-xs text-muted-foreground">{{ t('library.creator.metadata.regex.valuesHint') }}</p>

        <section class="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-muted p-3 text-xs">
          <h3 class="font-medium">{{ t('library.creator.metadata.regex.exampleTitle') }}</h3>
          <dl class="flex min-w-0 flex-col gap-1">
            <dt class="text-muted-foreground">{{ t('library.creator.metadata.regex.sourceTitle') }}</dt>
            <dd class="select-text break-all font-mono">{{ examplePattern }}</dd>
            <dt class="mt-1 text-muted-foreground">{{ t('library.creator.metadata.regex.exampleTestPath') }}</dt>
            <dd class="select-text break-all font-mono">{{ examplePath }}</dd>
          </dl>
        </section>

        <fieldset :disabled="!enabled" class="flex min-w-0 flex-col gap-3 disabled:opacity-50">
          <legend class="sr-only">{{ t('library.creator.metadata.regex.rules') }}</legend>
          <div v-for="(rule, index) in rules" :key="index" class="flex min-w-0 flex-col gap-2 rounded-md border border-border p-3">
            <div class="flex items-center justify-between gap-2">
              <label :for="`regex-pattern-${index}`" class="text-sm font-medium">{{
                t('library.creator.metadata.regex.rule', { number: index + 1 })
              }}</label>
              <div class="flex gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  :disabled="index === 0"
                  :aria-label="t('library.creator.metadata.regex.moveUp')"
                  @click="moveUp(index)"
                  ><ArrowUp
                /></Button>
                <Button
                  variant="ghost"
                  size="icon"
                  :disabled="index === rules.length - 1"
                  :aria-label="t('library.creator.metadata.regex.moveDown')"
                  @click="moveDown(index)"
                  ><ArrowDown
                /></Button>
                <Button variant="ghost" size="icon" :aria-label="t('library.creator.metadata.regex.remove')" @click="removeRule(index)"
                  ><Trash2
                /></Button>
              </div>
            </div>
            <div
              class="flex min-w-0 flex-wrap items-center rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring"
              :class="patternInvalid[index] ? 'border-destructive' : 'border-input'"
            >
              <span class="px-2 py-2 text-xs text-muted-foreground">{{ t('library.creator.metadata.regex.basePath') }} /</span>
              <input
                :id="`regex-pattern-${index}`"
                v-model="rule.pattern"
                :maxlength="REGEX_METADATA_LIMITS.patternLength"
                :aria-describedby="`regex-extension-${index} regex-errors-${index}`"
                :aria-invalid="patternInvalid[index] || undefined"
                autocomplete="off"
                spellcheck="false"
                class="min-w-24 flex-1 bg-transparent px-2 py-2 font-mono text-sm outline-none"
              />
              <span
                :id="`regex-extension-${index}`"
                :title="t('library.creator.metadata.regex.extensionHint')"
                class="px-2 py-2 font-mono text-xs text-muted-foreground"
                >.ext<span class="sr-only">: {{ t('library.creator.metadata.regex.extensionHint') }}</span></span
              >
            </div>
            <label class="flex items-center gap-2 text-xs text-muted-foreground">
              {{ t('library.creator.metadata.regex.flags') }}
              <Input
                v-model="rule.flags"
                :aria-describedby="`regex-errors-${index}`"
                :aria-invalid="flagsInvalid[index] || undefined"
                maxlength="2"
                class="w-20 font-mono"
                autocomplete="off"
                spellcheck="false"
              />
            </label>
            <div :id="`regex-errors-${index}`" aria-live="polite">
              <p v-for="code in ruleErrors[index]" :key="code" class="text-xs text-destructive">
                {{ t(`library.creator.metadata.regex.diagnostics.${code}`) }}
              </p>
            </div>
          </div>
          <Button variant="outline" :disabled="rules.length >= REGEX_METADATA_LIMITS.rules" class="self-start" @click="addRule"
            ><Plus />{{ t('library.creator.metadata.regex.add') }}</Button
          >
          <label class="flex flex-col gap-1 text-sm">
            {{ t('library.creator.metadata.regex.examplePath') }}
            <Input
              v-model="relativePath"
              :maxlength="REGEX_METADATA_LIMITS.pathLength"
              :placeholder="t('library.creator.metadata.regex.examplePlaceholder')"
            />
          </label>
          <Button variant="outline" :disabled="!canPreview" class="self-start" @click="preview">{{
            t(busy ? 'library.creator.metadata.regex.previewing' : 'library.creator.metadata.regex.preview')
          }}</Button>
        </fieldset>

        <div v-if="enabled" aria-live="polite" class="flex flex-col gap-2 text-sm">
          <p v-if="!validRuleCount" class="text-destructive">{{ t('library.creator.metadata.regex.validationRuleCount') }}</p>
          <p v-else-if="validating" class="text-muted-foreground">{{ t('library.creator.metadata.regex.validating') }}</p>
          <p v-else-if="validation?.valid" class="text-muted-foreground">{{ t('library.creator.metadata.regex.validationSuccess') }}</p>
          <p v-if="validationError" role="alert" class="text-destructive">{{ t('library.creator.metadata.regex.validationError') }}</p>
          <p v-for="diagnostic in generalDiagnostics" :key="diagnostic.code" class="text-destructive">
            {{ t(`library.creator.metadata.regex.diagnostics.${diagnostic.code}`) }}
          </p>
          <Button
            v-if="validationError || generalDiagnostics.length"
            variant="outline"
            class="self-start"
            :disabled="validating"
            @click="validateRules"
            >{{ t('library.creator.metadata.regex.validationRetry') }}</Button
          >
        </div>

        <p v-if="error" role="alert" class="text-sm text-destructive">{{ t('library.creator.metadata.regex.previewError') }}</p>
        <div v-if="result" aria-live="polite" class="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
          <p>
            {{ t('library.creator.metadata.regex.actualInput') }} <code class="break-all">{{ result.inputPath }}</code>
          </p>
          <p>
            {{
              result.matched
                ? t('library.creator.metadata.regex.matched', { number: (result.ruleIndex ?? 0) + 1 })
                : t('library.creator.metadata.regex.noMatch')
            }}
          </p>
          <dl v-if="result.matched" class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <template v-for="(fieldValue, field) in result.metadata" :key="field"
              ><dt class="font-mono text-xs">{{ field }}</dt>
              <dd class="break-all">{{ Array.isArray(fieldValue) ? fieldValue.join('; ') : fieldValue }}</dd></template
            >
          </dl>
          <p v-for="(diagnostic, index) in result.diagnostics" :key="index" class="text-destructive">
            {{ t(`library.creator.metadata.regex.diagnostics.${diagnostic.code}`) }} <span v-if="diagnostic.field">({{ diagnostic.field }})</span>
          </p>
        </div>
        <p class="text-xs text-muted-foreground">{{ t('library.creator.metadata.regex.scanHint') }}</p>
        <div class="flex justify-end gap-2">
          <Button variant="outline" @click="close">{{ t('common.cancel') }}</Button>
          <Button :disabled="!canApply" @click="apply">{{ t('library.creator.metadata.regex.apply') }}</Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
