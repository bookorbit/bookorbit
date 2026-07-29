import { parse, TYPE } from '@formatjs/icu-messageformat-parser'
import { baseCompile } from '@intlify/message-compiler'

const ICU_PLURAL_PATTERN = /\{\s*[\w.-]+\s*,\s*(?:plural|selectordinal)\s*,/

export function isIcuPluralMessage(message) {
  return ICU_PLURAL_PATTERN.test(message)
}

function argumentSignature(element) {
  const type = {
    [TYPE.argument]: 'argument',
    [TYPE.number]: 'number',
    [TYPE.date]: 'date',
    [TYPE.time]: 'time',
    [TYPE.select]: 'select',
    [TYPE.plural]: element.pluralType,
  }[element.type]
  const style = 'style' in element && element.style !== null ? `:${JSON.stringify(element.style)}` : ''
  return `${element.value}:${type}${style}`
}

function optionHasContent(elements) {
  return elements.some((element) => {
    if (element.type === TYPE.literal) return element.value.trim().length > 0
    if (element.type === TYPE.tag) return optionHasContent(element.children)
    return true
  })
}

function walkOptions(element, analysis) {
  for (const [selector, option] of Object.entries(element.options)) {
    if (!optionHasContent(option.value)) {
      analysis.emptyOptions.push({
        argument: element.value,
        selector,
      })
    }
    walkElements(option.value, analysis)
  }
}

function walkElements(elements, analysis) {
  for (const element of elements) {
    if (
      element.type === TYPE.argument ||
      element.type === TYPE.number ||
      element.type === TYPE.date ||
      element.type === TYPE.time ||
      element.type === TYPE.select ||
      element.type === TYPE.plural
    ) {
      analysis.arguments.add(element.value)
      analysis.argumentSignatures.add(argumentSignature(element))
    }

    if (element.type === TYPE.select) {
      analysis.selects.push({
        argument: element.value,
        selectors: Object.keys(element.options),
      })
      walkOptions(element, analysis)
    }

    if (element.type === TYPE.plural) {
      analysis.plurals.push({
        argument: element.value,
        offset: element.offset,
        type: element.pluralType,
        selectors: Object.keys(element.options),
      })
      walkOptions(element, analysis)
    }

    if (element.type === TYPE.tag) walkElements(element.children, analysis)
  }
}

export function analyzeIcuMessage(message) {
  const analysis = {
    arguments: new Set(),
    argumentSignatures: new Set(),
    emptyOptions: [],
    plurals: [],
    selects: [],
  }
  walkElements(parse(message), analysis)

  return {
    arguments: [...analysis.arguments].sort(),
    argumentSignatures: [...analysis.argumentSignatures].sort(),
    emptyOptions: analysis.emptyOptions,
    plurals: analysis.plurals.map((plural) => ({
      ...plural,
      selectors: [...plural.selectors].sort(),
    })),
    selects: analysis.selects.map((select) => ({
      ...select,
      selectors: [...select.selectors].sort(),
    })),
  }
}

function pluralCategories(locale, type) {
  return new Intl.PluralRules(locale, { type }).resolvedOptions().pluralCategories
}

function exactSelectors(selectors) {
  return selectors.filter((selector) => selector.startsWith('='))
}

function analyzeVueMessage(message) {
  const errors = []
  const { ast } = baseCompile(message, {
    onError: (error) => errors.push(error.message),
  })
  const placeholders = new Set()

  function walk(value) {
    if (Array.isArray(value)) {
      for (const child of value) walk(child)
      return
    }
    if (!value || typeof value !== 'object') return
    if (value.type === 4) placeholders.add(`named:${value.key}`)
    if (value.type === 5) placeholders.add(`list:${value.index}`)
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'loc') walk(child)
    }
  }

  walk(ast.body)
  return {
    errors,
    isPlural: ast.body.type === 1,
    placeholders: [...placeholders].sort(),
  }
}

function pluralOptionPounds(elements) {
  let totals = [0]

  const combine = (other) => {
    totals = [...new Set(totals.flatMap((total) => other.map((addition) => total + addition)))]
  }

  for (const element of elements) {
    if (element.type === TYPE.pound) combine([1])
    else if (element.type === TYPE.tag) combine(pluralOptionPounds(element.children))
    else if (element.type === TYPE.select || element.type === TYPE.plural) {
      combine(Object.values(element.options).flatMap((option) => pluralOptionPounds(option.value)))
    }
  }

  return totals
}

export function validateSlotCountMessage({ key, locale, message }) {
  if (!isIcuPluralMessage(message)) return [`${locale}: ICU plural syntax required for slot count message ${key}`]

  let totals
  try {
    totals = pluralOptionPounds(parse(message))
  } catch {
    return []
  }

  return totals.every((total) => total === 1) ? [] : [`${locale}: slot count message ${key} must render exactly one # in every branch`]
}

export function validateLocaleMessage({ key, locale, message, referenceMessage }) {
  const errors = []
  const referenceIsIcu = isIcuPluralMessage(referenceMessage)
  const messageIsIcu = isIcuPluralMessage(message)

  if (!referenceIsIcu) {
    const referenceAnalysis = analyzeVueMessage(referenceMessage)
    const messageAnalysis = analyzeVueMessage(message)

    if (messageIsIcu) errors.push(`${locale}: unexpected ICU plural syntax in ${key}`)
    if (referenceAnalysis.isPlural) errors.push(`${locale}: legacy plural branches are not allowed for ${key}`)
    if (messageAnalysis.isPlural && message !== referenceMessage) {
      errors.push(`${locale}: legacy plural branches are not allowed for ${key}`)
    }

    if (messageAnalysis.errors.length > 0) {
      errors.push(`${locale}: invalid Vue I18n syntax in ${key}: ${messageAnalysis.errors.join('; ')}`)
      return errors
    }

    if (messageAnalysis.placeholders.join(',') !== referenceAnalysis.placeholders.join(',')) {
      errors.push(`${locale}: placeholders differ for ${key}`)
    }

    return errors
  }

  if (message.includes(' | ')) errors.push(`${locale}: legacy plural branches are not allowed for ICU message ${key}`)
  if (!messageIsIcu) {
    errors.push(`${locale}: ICU plural syntax required for ${key}`)
    return errors
  }

  let referenceAnalysis
  let messageAnalysis
  try {
    referenceAnalysis = analyzeIcuMessage(referenceMessage)
  } catch (error) {
    errors.push(`en: invalid ICU syntax in ${key}: ${error.message}`)
    return errors
  }
  try {
    messageAnalysis = analyzeIcuMessage(message)
  } catch (error) {
    errors.push(`${locale}: invalid ICU syntax in ${key}: ${error.message}`)
    return errors
  }

  const argumentsMatch = messageAnalysis.arguments.join(',') === referenceAnalysis.arguments.join(',')
  if (!argumentsMatch) {
    errors.push(`${locale}: ICU arguments differ for ${key}`)
  }
  if (argumentsMatch && messageAnalysis.argumentSignatures.join(',') !== referenceAnalysis.argumentSignatures.join(',')) {
    errors.push(`${locale}: ICU argument types differ for ${key}`)
  }
  for (const option of messageAnalysis.emptyOptions) {
    errors.push(`${locale}: empty ICU option ${option.selector} for ${option.argument} in ${key}`)
  }
  const selectSignatures = (analysis) => analysis.selects.map((select) => `${select.argument}:${select.selectors.join(',')}`).sort()
  if (selectSignatures(messageAnalysis).join('|') !== selectSignatures(referenceAnalysis).join('|')) {
    errors.push(`${locale}: ICU select expressions differ for ${key}`)
  }
  if (messageAnalysis.plurals.length !== referenceAnalysis.plurals.length) {
    errors.push(`${locale}: ICU plural expressions differ for ${key}`)
    return errors
  }

  const remainingPlurals = [...messageAnalysis.plurals]
  for (const referencePlural of referenceAnalysis.plurals) {
    const matchingIndex = remainingPlurals.findIndex((plural) => plural.argument === referencePlural.argument)
    const messagePlural = remainingPlurals.splice(matchingIndex === -1 ? 0 : matchingIndex, 1)[0]
    if (
      messagePlural.argument !== referencePlural.argument ||
      messagePlural.offset !== referencePlural.offset ||
      messagePlural.type !== referencePlural.type
    ) {
      errors.push(`${locale}: ICU plural expressions differ for ${key}`)
      continue
    }

    const selectors = new Set(messagePlural.selectors)
    for (const selector of exactSelectors(referencePlural.selectors)) {
      if (!selectors.has(selector)) errors.push(`${locale}: ICU selector ${selector} missing for ${key}`)
    }
    const requiredCategories = new Set([...pluralCategories(locale, messagePlural.type), 'other'])
    for (const category of requiredCategories) {
      if (!selectors.has(category)) errors.push(`${locale}: ICU plural category ${category} missing for ${key}`)
    }
  }

  return errors
}
