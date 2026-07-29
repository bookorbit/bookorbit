import IntlMessageFormat from 'intl-messageformat'
import { TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser'
import type { MessageContext, MessageFunction } from 'vue-i18n'
import type { Locale } from '@bookorbit/types'

const ICU_PLURAL_PATTERN = /\{\s*[\w.-]+\s*,\s*(?:plural|selectordinal)\s*,/
const ICU_COUNT_MARKER_ARGUMENT = '__bookorbitIcuCountMarker'
const ICU_COUNT_START = '\uE000'
const ICU_COUNT_END = '\uE001'

export function isIcuPluralMessage(message: string): boolean {
  return ICU_PLURAL_PATTERN.test(message)
}

export interface IcuCountPart {
  isCount: boolean
  value: string
}

export function splitIcuCount(message: string): IcuCountPart[] {
  if (!message.includes(ICU_COUNT_START)) return [{ isCount: false, value: message }]
  const parts: IcuCountPart[] = []
  let start = 0
  let markerStart = message.indexOf(ICU_COUNT_START)

  while (markerStart !== -1) {
    const markerEnd = message.indexOf(ICU_COUNT_END, markerStart + ICU_COUNT_START.length)
    if (markerEnd === -1) return [{ isCount: false, value: message }]
    if (markerStart > start) parts.push({ isCount: false, value: message.slice(start, markerStart) })
    parts.push({
      isCount: true,
      value: message.slice(markerStart + ICU_COUNT_START.length, markerEnd),
    })
    start = markerEnd + ICU_COUNT_END.length
    markerStart = message.indexOf(ICU_COUNT_START, start)
  }
  if (start < message.length) parts.push({ isCount: false, value: message.slice(start) })

  return parts
}

export function icuCountValues(count: number): Record<string, number | boolean> {
  return {
    [ICU_COUNT_MARKER_ARGUMENT]: true,
    count,
  }
}

function markIcuCounts(elements: MessageFormatElement[]): MessageFormatElement[] {
  return elements.flatMap((element): MessageFormatElement[] => {
    if (element.type === TYPE.pound) {
      return [{ type: TYPE.literal, value: ICU_COUNT_START }, element, { type: TYPE.literal, value: ICU_COUNT_END }]
    }
    if (element.type === TYPE.select || element.type === TYPE.plural) {
      return [
        {
          ...element,
          options: Object.fromEntries(
            Object.entries(element.options).map(([selector, option]) => [
              selector,
              {
                ...option,
                value: markIcuCounts(option.value),
              },
            ]),
          ),
        },
      ]
    }
    if (element.type === TYPE.tag) return [{ ...element, children: markIcuCounts(element.children) }]
    return [element]
  })
}

function compileIcuMessage(message: string, locale: Locale): MessageFunction {
  const formatter = new IntlMessageFormat(message, locale)
  const countMarkerFormatter = new IntlMessageFormat(markIcuCounts(formatter.getAst()), locale)

  return (context: MessageContext): string => {
    const values = (context.values ?? {}) as Record<string, unknown>
    const activeFormatter = values[ICU_COUNT_MARKER_ARGUMENT] === true ? countMarkerFormatter : formatter

    // ICU formatting throws on missing arguments, so degrade to the raw message instead of breaking the render.
    try {
      const formatted = activeFormatter.format(values)
      return Array.isArray(formatted) ? formatted.join('') : String(formatted)
    } catch (error) {
      if (import.meta.env.DEV) console.warn(`[i18n] Failed to format ICU message "${message}"`, error)
      return message
    }
  }
}

function compileValue(value: unknown, locale: Locale): unknown {
  if (typeof value === 'string') return isIcuPluralMessage(value) ? compileIcuMessage(value, locale) : value
  if (Array.isArray(value)) return value.map((item) => compileValue(item, locale))
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, compileValue(child, locale)]))
}

export function compileIcuCatalog<T>(catalog: T, locale: Locale): T {
  return compileValue(catalog, locale) as T
}
