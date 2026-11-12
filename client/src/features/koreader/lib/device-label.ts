/**
 * KOReader reports devices by model id: Kobos by codename ("Kobo_monza"), Kindles by a run-together
 * name ("KindlePaperWhite5"). These are the names on the box. Kept in step with the plugin's own copy
 * in `koreader-plugin/bookorbit.koplugin/bookorbit_device_names.lua`; a test compares the two.
 */
export const KOREADER_MODEL_NAMES: Readonly<Record<string, string>> = {
  Kobo_trilogy_A: 'Kobo Touch',
  Kobo_trilogy_B: 'Kobo Touch',
  Kobo_trilogy_C: 'Kobo Touch',
  Kobo_pixie: 'Kobo Mini',
  Kobo_kraken: 'Kobo Glo',
  Kobo_dragon: 'Kobo Aura HD',
  Kobo_phoenix: 'Kobo Aura',
  Kobo_dahlia: 'Kobo Aura H2O',
  Kobo_alyssum: 'Kobo Glo HD',
  Kobo_pika: 'Kobo Touch 2.0',
  Kobo_star: 'Kobo Aura',
  Kobo_star_r2: 'Kobo Aura',
  Kobo_daylight: 'Kobo Aura One',
  Kobo_snow: 'Kobo Aura H2O',
  Kobo_snow_r2: 'Kobo Aura H2O',
  Kobo_nova: 'Kobo Clara HD',
  Kobo_frost: 'Kobo Forma',
  Kobo_storm: 'Kobo Libra H2O',
  Kobo_luna: 'Kobo Nia',
  Kobo_europa: 'Kobo Elipsa',
  Kobo_cadmus: 'Kobo Sage',
  Kobo_io: 'Kobo Libra 2',
  Kobo_goldfinch: 'Kobo Clara 2E',
  Kobo_condor: 'Kobo Elipsa 2E',
  Kobo_monza: 'Kobo Libra Colour',
  Kobo_spaBW: 'Kobo Clara BW',
  Kobo_spaColour: 'Kobo Clara Colour',
  Kindle2: 'Kindle 2',
  KindleDXG: 'Kindle DX',
  Kindle3: 'Kindle Keyboard',
  Kindle4: 'Kindle 4',
  KindleTouch: 'Kindle Touch',
  KindlePaperWhite: 'Kindle Paperwhite',
  KindlePaperWhite2: 'Kindle Paperwhite 2',
  KindlePaperWhite3: 'Kindle Paperwhite 3',
  KindlePaperWhite4: 'Kindle Paperwhite 4',
  KindlePaperWhite5: 'Kindle Paperwhite 5',
  KindlePaperWhite5SE: 'Kindle Paperwhite Signature',
  KindlePaperWhite6: 'Kindle Paperwhite 6',
  KindleBasic: 'Kindle',
  KindleBasic2: 'Kindle',
  KindleBasic3: 'Kindle',
  KindleBasic4: 'Kindle',
  KindleBasic5: 'Kindle',
  KindleVoyage: 'Kindle Voyage',
  KindleOasis: 'Kindle Oasis',
  KindleOasis2: 'Kindle Oasis',
  KindleOasis3: 'Kindle Oasis',
  KindleScribe: 'Kindle Scribe',
  KindleScribe3: 'Kindle Scribe',
  KindleColorSoft: 'Kindle Colorsoft',
  KindleScribeColorSoft: 'Kindle Scribe Colorsoft',
}

/** The name a user gave the device, else the retail name of a known model, else the model as reported. */
export function koreaderDeviceLabel(model: string, deviceName?: string | null): string {
  const name = deviceName?.trim()
  if (name) return name
  return Object.hasOwn(KOREADER_MODEL_NAMES, model) ? KOREADER_MODEL_NAMES[model]! : model
}

/** The reported model, when the label shown in its place does not already say it. */
export function koreaderDeviceModelHint(model: string, deviceName?: string | null): string | null {
  return koreaderDeviceLabel(model, deviceName) === model ? null : model
}

/** The label for a device whose model may be unknown, or null when nothing names it. */
export function koreaderOptionalDeviceLabel(model: string | null | undefined, deviceName?: string | null): string | null {
  const name = deviceName?.trim()
  if (name) return name
  return model ? koreaderDeviceLabel(model) : null
}
