import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KOREADER_MODEL_NAMES, koreaderDeviceLabel, koreaderDeviceModelHint, koreaderOptionalDeviceLabel } from '../device-label'

const pluginNamesPath = join(process.cwd(), '..', 'koreader-plugin', 'bookorbit.koplugin', 'bookorbit_device_names.lua')

function pluginModelNames(): Record<string, string> {
  const source = readFileSync(pluginNamesPath, 'utf8')
  const table = source.slice(source.indexOf('local NAMES = {'), source.indexOf('\n}\n'))
  return Object.fromEntries([...table.matchAll(/(\w+)\s*=\s*"([^"]+)"/g)].map((match) => [match[1], match[2]]))
}

describe('koreaderDeviceLabel', () => {
  it('prefers the name the user gave the device', () => {
    expect(koreaderDeviceLabel('blazer', 'Pixel 8')).toBe('Pixel 8')
    expect(koreaderDeviceLabel('Kobo_monza', '  Bedside Kobo  ')).toBe('Bedside Kobo')
  })

  it('names a known model as it is sold when the user gave no name', () => {
    expect(koreaderDeviceLabel('Kobo_monza')).toBe('Kobo Libra Colour')
    expect(koreaderDeviceLabel('KindlePaperWhite5', null)).toBe('Kindle Paperwhite 5')
    expect(koreaderDeviceLabel('Kobo_spaBW', '   ')).toBe('Kobo Clara BW')
  })

  it('shows an unknown model as reported', () => {
    expect(koreaderDeviceLabel('blazer')).toBe('blazer')
    expect(koreaderDeviceLabel('toString')).toBe('toString')
  })
})

describe('koreaderDeviceModelHint', () => {
  it('gives the reported model only when the label hides it', () => {
    expect(koreaderDeviceModelHint('blazer', 'Pixel 8')).toBe('blazer')
    expect(koreaderDeviceModelHint('Kobo_monza')).toBe('Kobo_monza')
    expect(koreaderDeviceModelHint('blazer')).toBeNull()
  })
})

describe('koreaderOptionalDeviceLabel', () => {
  it('prefers the given name, then the retail name, then the model', () => {
    expect(koreaderOptionalDeviceLabel('Kobo_io', ' Bedside ')).toBe('Bedside')
    expect(koreaderOptionalDeviceLabel(null, 'Bedside')).toBe('Bedside')
    expect(koreaderOptionalDeviceLabel('Kobo_io', null)).toBe('Kobo Libra 2')
    expect(koreaderOptionalDeviceLabel('Marginalia')).toBe('Marginalia')
  })

  it('names nothing when neither a name nor a model is known', () => {
    expect(koreaderOptionalDeviceLabel(null, null)).toBeNull()
    expect(koreaderOptionalDeviceLabel(undefined, '  ')).toBeNull()
    expect(koreaderOptionalDeviceLabel('', undefined)).toBeNull()
  })
})

describe('KOREADER_MODEL_NAMES', () => {
  it("matches the plugin's own list of model names", () => {
    const pluginNames = pluginModelNames()
    expect(Object.keys(pluginNames).length).toBeGreaterThan(40)
    expect(KOREADER_MODEL_NAMES).toEqual(pluginNames)
  })
})
