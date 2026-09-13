import { computed } from 'vue'
import type { ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { AMAZON_DOMAINS, AUDIBLE_DOMAINS, KOBO_COUNTRIES, KOBO_LANGUAGES, PROVIDER_FIELD_WIDTHS, type ProviderRowDef } from '../lib/provider-rows'

const { SELECT_WIDTH, WIDE_SELECT_WIDTH, SECRET_WIDTH } = PROVIDER_FIELD_WIDTHS

/**
 * Every provider BookOrbit can talk to, with its credentials and the medium it covers.
 * Provider names are proper nouns and stay untranslated; hints and field labels do not.
 */
export function useProviderRows(): ComputedRef<ProviderRowDef[]> {
  const { t } = useI18n()

  return computed<ProviderRowDef[]>(() => [
    {
      key: 'google',
      label: 'Google Books',
      group: 'books',
      hint: t('settings.metadata.providers.hints.google'),
      fields: [
        {
          key: 'apiKey',
          label: t('settings.metadata.providers.fields.apiKey'),
          type: 'password',
          placeholder: 'AIza...',
          helper: t('settings.metadata.providers.helpers.googleApiKey'),
          alwaysEditable: true,
          widthClass: SECRET_WIDTH,
        },
      ],
      enableRequirement: {
        isConfigured: (c) => !!c.google.apiKey.trim(),
        blockedMessage: t('settings.metadata.providers.blocked.google'),
      },
    },
    {
      key: 'amazon',
      label: 'Amazon',
      group: 'books',
      hint: t('settings.metadata.providers.hints.amazon'),
      fields: [
        {
          key: 'domain',
          label: t('settings.metadata.providers.fields.region'),
          type: 'select',
          options: AMAZON_DOMAINS,
          widthClass: WIDE_SELECT_WIDTH,
        },
        {
          key: 'cookie',
          label: t('settings.metadata.providers.fields.cookie'),
          type: 'password',
          placeholder: 'session-id=...; ubid-main=...; x-main=...',
          widthClass: SECRET_WIDTH,
        },
      ],
    },
    { key: 'goodreads', label: 'Goodreads', group: 'books', hint: t('settings.metadata.providers.hints.goodreads'), fields: [] },
    {
      key: 'hardcover',
      label: 'Hardcover',
      group: 'books',
      hint: t('settings.metadata.providers.hints.hardcover'),
      fields: [
        {
          key: 'apiKey',
          label: t('settings.metadata.providers.fields.apiKey'),
          type: 'password',
          placeholder: 'eyJ...',
          alwaysEditable: true,
          widthClass: SECRET_WIDTH,
        },
      ],
      enableRequirement: {
        isConfigured: (c) => !!c.hardcover.apiKey.trim(),
        blockedMessage: t('settings.metadata.providers.blocked.hardcover'),
        requiresPassingTest: true,
        missingTestMessage: t('settings.metadata.providers.blocked.hardcoverTest'),
      },
    },
    { key: 'openLibrary', label: 'Open Library', group: 'books', hint: t('settings.metadata.providers.hints.openLibrary'), fields: [] },
    {
      key: 'itunes',
      label: 'iTunes',
      group: 'books',
      hint: t('settings.metadata.providers.hints.itunes'),
      fields: [
        {
          key: 'coverResolution',
          label: t('settings.metadata.providers.fields.coverResolution'),
          type: 'select',
          options: ['high', 'standard'],
          widthClass: SELECT_WIDTH,
        },
      ],
    },
    {
      key: 'kobo',
      label: 'Kobo',
      group: 'books',
      hint: t('settings.metadata.providers.hints.kobo'),
      fields: [
        {
          key: 'country',
          label: t('settings.metadata.providers.fields.country'),
          type: 'select',
          options: KOBO_COUNTRIES,
          alwaysEditable: true,
          widthClass: SELECT_WIDTH,
        },
        {
          key: 'language',
          label: t('settings.metadata.providers.fields.language'),
          type: 'select',
          options: KOBO_LANGUAGES,
          alwaysEditable: true,
          widthClass: SELECT_WIDTH,
        },
      ],
    },
    {
      key: 'audible',
      label: 'Audible',
      group: 'audiobooks',
      hint: t('settings.metadata.providers.hints.audible'),
      fields: [
        {
          key: 'domain',
          label: t('settings.metadata.providers.fields.region'),
          type: 'select',
          options: AUDIBLE_DOMAINS,
          widthClass: WIDE_SELECT_WIDTH,
        },
      ],
    },
    { key: 'audnexus', label: 'AudNexus', group: 'audiobooks', hint: t('settings.metadata.providers.hints.audnexus'), fields: [] },
    { key: 'librofm', label: 'Libro.fm', group: 'audiobooks', hint: t('settings.metadata.providers.hints.librofm'), fields: [] },
    {
      key: 'comicvine',
      label: 'ComicVine',
      group: 'comics',
      hint: t('settings.metadata.providers.hints.comicvine'),
      fields: [
        {
          key: 'apiKey',
          label: t('settings.metadata.providers.fields.apiKey'),
          type: 'password',
          alwaysEditable: true,
          widthClass: SECRET_WIDTH,
        },
      ],
      enableRequirement: {
        isConfigured: (c) => !!c.comicvine.apiKey.trim(),
        blockedMessage: t('settings.metadata.providers.blocked.comicvine'),
      },
    },
    { key: 'ranobedb', label: 'RanobeDB', group: 'comics', hint: t('settings.metadata.providers.hints.ranobedb'), fields: [] },
    { key: 'lubimyczytac', label: 'LubimyCzytac', group: 'regional', hint: t('settings.metadata.providers.hints.lubimyczytac'), fields: [] },
    {
      key: 'aladin',
      label: 'Aladin',
      group: 'regional',
      hint: t('settings.metadata.providers.hints.aladin'),
      fields: [
        {
          key: 'ttbKey',
          label: t('settings.metadata.providers.fields.ttbKey'),
          type: 'password',
          placeholder: 'ttb...',
          alwaysEditable: true,
          widthClass: SECRET_WIDTH,
        },
      ],
      enableRequirement: {
        isConfigured: (c) => !!c.aladin.ttbKey.trim(),
        blockedMessage: t('settings.metadata.providers.blocked.aladin'),
      },
    },
  ])
}
