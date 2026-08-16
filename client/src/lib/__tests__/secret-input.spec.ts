// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SECRET_INPUT_ATTRS } from '../secret-input'

const SRC_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/**
 * `input[type="password"]` is only legitimate for a BookOrbit login credential.
 * Chrome's password manager tracks every password input on the origin, so one
 * holding a provider API key or an external client credential makes each
 * client-side route change look like a submitted login form and pops the
 * "Save/Update password?" bubble. Secrets that are not BookOrbit credentials
 * must use a masked text input instead; see `@/lib/secret-input`.
 *
 * Only add a file here when the field really does hold the password of the
 * BookOrbit account the browser is signed in as.
 */
const BOOKORBIT_CREDENTIAL_FILES = [
  'features/auth/ChangePasswordDialog.vue',
  'features/auth/LoginPage.vue',
  'features/auth/RegisterPage.vue',
  'features/auth/ResetPasswordPage.vue',
  'features/auth/SetupPage.vue',
  'features/settings/AccountSettings.vue',
]

/** Matches a literal `type="password"` and a binding whose branch yields 'password'. */
const STATIC_PASSWORD_TYPE = /type="password"/
const BOUND_PASSWORD_TYPE = /:type="[^"]*[?:]\s*'password'/

function rendersPasswordInput(source: string): boolean {
  return STATIC_PASSWORD_TYPE.test(source) || BOUND_PASSWORD_TYPE.test(source)
}

function collectVueFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...collectVueFiles(full))
      continue
    }
    if (entry.name.endsWith('.vue')) found.push(full)
  }
  return found
}

function toRelativePath(file: string): string {
  return relative(SRC_ROOT, file).split(sep).join('/')
}

describe('secret input policy', () => {
  const vueFiles = collectVueFiles(SRC_ROOT).map((file) => ({ path: toRelativePath(file), source: readFileSync(file, 'utf8') }))

  it('walks the whole component tree', () => {
    expect(vueFiles.length).toBeGreaterThan(100)
  })

  it('restricts input[type=password] to BookOrbit credential forms', () => {
    const offenders = vueFiles.filter((file) => rendersPasswordInput(file.source)).map((file) => file.path)

    expect([...offenders].sort()).toEqual(BOOKORBIT_CREDENTIAL_FILES)
  })

  it('masks every secret input it renders with the input-secret class', () => {
    const missingMask = vueFiles.filter((file) => file.source.includes('SECRET_INPUT_ATTRS') && !file.source.includes('input-secret'))

    expect(missingMask.map((file) => file.path)).toEqual([])
  })

  it('covers the settings surfaces that triggered the Chrome password bubble', () => {
    const converted = vueFiles.filter((file) => file.source.includes('SECRET_INPUT_ATTRS')).map((file) => file.path)

    expect(converted).toEqual(
      expect.arrayContaining([
        'features/settings/metadata-preferences/components/ProviderConfigPanel.vue',
        'features/hardcover/components/HardcoverConnectionCard.vue',
        'features/readwise/components/ReadwiseSettings.vue',
        'features/storygraph/components/StorygraphConnectionCard.vue',
        'features/migration/components/MigrationSourceFields.vue',
        'features/settings/OpdsSettings.vue',
        'features/settings/KoreaderSettings.vue',
        'features/settings/OidcSettings.vue',
        'features/email/components/ProvidersTab.vue',
      ]),
    )
  })

  it('exposes anti-autofill attributes and never a password type', () => {
    expect(SECRET_INPUT_ATTRS).toMatchObject({
      autocomplete: 'off',
      autocorrect: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
    })
    expect(Object.values(SECRET_INPUT_ATTRS)).not.toContain('password')
    expect(SECRET_INPUT_ATTRS).not.toHaveProperty('type')
  })

  it('defines the mask with a supported CSS property', () => {
    const css = readFileSync(join(SRC_ROOT, 'assets/main.css'), 'utf8')

    expect(css).toMatch(/\.input-secret\s*\{[^}]*-webkit-text-security:\s*disc/)
  })
})
