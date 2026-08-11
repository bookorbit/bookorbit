/**
 * Attributes for inputs holding a secret that is not a BookOrbit login credential:
 * provider API keys, sync tokens, SMTP passwords, and credentials minted for
 * external clients such as OPDS or KOSync.
 *
 * Such fields must render as `type="text"` masked with the `input-secret` class
 * rather than `type="password"`. Chrome's password manager only tracks
 * `input[type="password"]`, and it deliberately ignores `autocomplete` when
 * deciding whether to offer to save one. A password input that Vue unmounts on a
 * router navigation matches Chrome's heuristic for a submitted login form, so
 * every settings tab click pops the "Save/Update password?" bubble.
 *
 * The `data-*` hints below are for third-party managers (1Password, LastPass,
 * Dashlane); Chrome does not read them, which is why the type change carries the
 * actual fix.
 */
export const SECRET_INPUT_ATTRS = {
  autocomplete: 'off',
  autocorrect: 'off',
  autocapitalize: 'off',
  spellcheck: 'false',
  'data-lpignore': 'true',
  'data-1p-ignore': 'true',
  'data-form-type': 'other',
} as const
