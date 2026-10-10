import { computed, onScopeDispose, ref, watch } from 'vue'
import { REGEX_METADATA_LIMITS, type RegexMetadataConfig, type RegexMetadataPreview, type RegexMetadataValidation } from '@bookorbit/types'
import { api } from '@/lib/api'

export function useRegexMetadataEditor(config: RegexMetadataConfig | null, libraryId?: number) {
  const enabled = ref(config !== null)
  const rules = ref(config?.rules.map((rule) => ({ ...rule })) ?? [{ pattern: '', flags: '' }])
  const relativePath = ref('')
  const result = ref<RegexMetadataPreview | null>(null)
  const busy = ref(false)
  const error = ref(false)
  let sequence = 0
  let controller: AbortController | undefined

  function invalidate() {
    sequence++
    controller?.abort()
    busy.value = false
    result.value = null
    error.value = false
  }
  watch([rules, relativePath, enabled], invalidate, { deep: true, flush: 'sync' })
  onScopeDispose(invalidate)

  const validation = ref<RegexMetadataValidation | null>(null)
  const validating = ref(false)
  const validationError = ref(false)
  let validationSequence = 0
  let validationController: AbortController | undefined
  let validationTimer: ReturnType<typeof setTimeout> | undefined

  const localRuleErrors = computed(() =>
    rules.value.map((rule) => {
      const errors: string[] = []
      if (!rule.pattern.length) errors.push('pattern_required')
      else if (rule.pattern.length > REGEX_METADATA_LIMITS.patternLength) errors.push('pattern_too_long')
      if (!/^(?:i?u?|ui)$/.test(rule.flags)) errors.push('invalid_flags')
      return errors
    }),
  )
  const validRuleCount = computed(() => rules.value.length > 0 && rules.value.length <= REGEX_METADATA_LIMITS.rules)
  const valid = computed(() => validRuleCount.value && localRuleErrors.value.every((errors) => !errors.length))
  const ruleErrors = computed(() =>
    localRuleErrors.value.map((errors, index) => [
      ...errors,
      ...(validation.value?.diagnostics.filter((diagnostic) => diagnostic.ruleIndex === index).map((diagnostic) => diagnostic.code) ?? []),
    ]),
  )
  const patternInvalid = computed(() => ruleErrors.value.map((errors) => errors.some((code) => code !== 'invalid_flags')))
  const flagsInvalid = computed(() => ruleErrors.value.map((errors) => errors.includes('invalid_flags')))
  const generalDiagnostics = computed(() => validation.value?.diagnostics.filter((diagnostic) => diagnostic.ruleIndex === undefined) ?? [])
  const canApply = computed(() => !enabled.value || (valid.value && validation.value?.valid === true && !validating.value && !validationError.value))
  const canPreview = computed(() => enabled.value && valid.value && !!relativePath.value && !busy.value)

  function invalidateValidation() {
    validationSequence++
    clearTimeout(validationTimer)
    validationController?.abort()
    validation.value = null
    validationError.value = false
    validating.value = false
  }

  async function validateRules() {
    invalidateValidation()
    if (!enabled.value || !valid.value) return
    const requestSequence = validationSequence
    validationController = new AbortController()
    validating.value = true
    try {
      const response = await api('/api/v1/libraries/regex-metadata/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: value(), libraryId }),
        signal: validationController.signal,
      })
      if (!response.ok) {
        if (requestSequence === validationSequence) validationError.value = true
        return
      }
      const data = (await response.json()) as RegexMetadataValidation
      if (requestSequence === validationSequence) validation.value = data
    } catch {
      if (requestSequence === validationSequence) validationError.value = true
    } finally {
      if (requestSequence === validationSequence) validating.value = false
    }
  }

  watch(
    [rules, enabled],
    () => {
      invalidateValidation()
      if (!enabled.value || !valid.value) return
      validating.value = true
      validationTimer = setTimeout(validateRules, 400)
    },
    { deep: true, flush: 'sync', immediate: true },
  )
  onScopeDispose(invalidateValidation)

  function addRule() {
    if (rules.value.length < REGEX_METADATA_LIMITS.rules) rules.value.push({ pattern: '', flags: '' })
  }
  function removeRule(index: number) {
    rules.value.splice(index, 1)
  }
  function moveRule(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= rules.value.length) return
    const next = [...rules.value]
    const [rule] = next.splice(index, 1)
    next.splice(target, 0, rule!)
    rules.value = next
  }
  function moveUp(index: number) {
    moveRule(index, -1)
  }
  function moveDown(index: number) {
    moveRule(index, 1)
  }

  function value(): RegexMetadataConfig | null {
    return enabled.value ? { rules: rules.value.map((rule) => ({ ...rule })) } : null
  }

  async function preview() {
    if (!canPreview.value) return
    invalidate()
    const requestSequence = sequence
    controller = new AbortController()
    busy.value = true
    try {
      const response = await api('/api/v1/libraries/regex-metadata/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: value(), relativePath: relativePath.value, libraryId }),
        signal: controller.signal,
      })
      if (!response.ok) {
        if (requestSequence === sequence) error.value = true
        return
      }
      const data = (await response.json()) as RegexMetadataPreview
      if (requestSequence === sequence) result.value = data
    } catch {
      if (requestSequence === sequence) error.value = true
    } finally {
      if (requestSequence === sequence) busy.value = false
    }
  }

  return {
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
  }
}
