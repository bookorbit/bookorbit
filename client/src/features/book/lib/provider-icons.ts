const PROVIDER_ICON_BASE_PATH = '/assets/provider-icons'

const PROVIDER_ICON_PATHS = {
  google: `${PROVIDER_ICON_BASE_PATH}/google.svg`,
  goodreads: `${PROVIDER_ICON_BASE_PATH}/goodreads.svg`,
  amazon: `${PROVIDER_ICON_BASE_PATH}/amazon.svg`,
  hardcover: `${PROVIDER_ICON_BASE_PATH}/hardcover.svg`,
  openLibrary: `${PROVIDER_ICON_BASE_PATH}/openlibrary.svg`,
  itunes: `${PROVIDER_ICON_BASE_PATH}/apple-books.svg`,
  audible: `${PROVIDER_ICON_BASE_PATH}/audible.svg`,
  ranobedb: `${PROVIDER_ICON_BASE_PATH}/ranobedb.svg`,
} as const

type ProviderIconKey = keyof typeof PROVIDER_ICON_PATHS

export function providerIconPath(provider: ProviderIconKey): string {
  return PROVIDER_ICON_PATHS[provider]
}
