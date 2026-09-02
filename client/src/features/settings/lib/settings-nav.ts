import type { Component } from 'vue'
import {
  Activity,
  Bell,
  BookMarked,
  BookOpen,
  Database,
  DownloadCloud,
  FileText,
  Filter,
  Folder,
  Globe,
  Headphones,
  Highlighter,
  Image,
  KeyRound,
  LayoutGrid,
  Library,
  LibraryBig,
  Link2,
  Lock,
  Mail,
  Palette,
  PanelBottom,
  Rss,
  ScrollText,
  Server,
  Shield,
  ShieldCheck,
  ShieldUser,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Star,
  Tablet,
  Tag,
  Type,
  User,
  Users,
  Wrench,
  Zap,
} from '@lucide/vue'
import { Permission } from '@bookorbit/types'

export interface SettingsNavContext {
  isSuperuser: boolean
  permissions: readonly string[]
  isDemoRestricted: boolean
}

/** Live signals the rail renders beside a row. Resolved by the nav, not stored in this file. */
export type SettingsNavStatus = 'libraryScan'

export interface SettingsNavItem {
  id: string
  routeName: string
  labelKey: string
  descriptionKey?: string
  icon: Component
  /** Extra English search terms so the rail search finds a page by concept, not just by title. */
  keywords?: string
  status?: SettingsNavStatus
  isVisible?: (context: SettingsNavContext) => boolean
  children?: SettingsNavItem[]
}

export interface SettingsNavGroup {
  id: string
  labelKey: string
  icon: Component
  items: SettingsNavItem[]
}

function anyPermission(...permissions: string[]): (context: SettingsNavContext) => boolean {
  return (context) => context.isSuperuser || permissions.some((permission) => context.permissions.includes(permission))
}

function superuserOnly(context: SettingsNavContext): boolean {
  return context.isSuperuser
}

export const SETTINGS_NAV: readonly SettingsNavGroup[] = [
  {
    id: 'you',
    labelKey: 'settings.nav.groups.you',
    icon: User,
    items: [
      {
        id: 'profile',
        routeName: 'settings-account-profile',
        labelKey: 'settings.account.tabs.profile',
        descriptionKey: 'settings.nav.descriptions.profile',
        icon: User,
        keywords: 'password email avatar username sessions sign out security',
      },
      {
        id: 'appearance',
        routeName: 'settings-appearance-theme',
        labelKey: 'settings.common.nav.display',
        icon: Palette,
        keywords: 'theme dark light accent colour color density radius',
        children: [
          {
            id: 'appearance-theme',
            routeName: 'settings-appearance-theme',
            labelKey: 'settings.appearance.tabs.theme',
            descriptionKey: 'settings.nav.descriptions.appearanceTheme',
            icon: Palette,
            keywords: 'theme dark light accent colour color background radius',
          },
          {
            id: 'appearance-book-covers',
            routeName: 'settings-appearance-book-covers',
            labelKey: 'settings.appearance.tabs.book-covers',
            descriptionKey: 'settings.nav.descriptions.appearanceBookCovers',
            icon: Image,
            keywords: 'cover shadow spine artwork placeholder thumbnail',
          },
          {
            id: 'appearance-icons',
            routeName: 'settings-appearance-icons',
            labelKey: 'settings.appearance.tabs.icons',
            descriptionKey: 'settings.nav.descriptions.appearanceIcons',
            icon: Sparkles,
            keywords: 'icon glyph outline solid',
          },
          {
            id: 'appearance-layout',
            routeName: 'settings-appearance-layout',
            labelKey: 'settings.appearance.tabs.layout',
            descriptionKey: 'settings.nav.descriptions.appearanceLayout',
            icon: LayoutGrid,
            keywords: 'grid list table density columns spacing',
          },
          {
            id: 'appearance-behavior',
            routeName: 'settings-appearance-behavior',
            labelKey: 'settings.appearance.tabs.behavior',
            descriptionKey: 'settings.nav.descriptions.appearanceBehavior',
            icon: SlidersHorizontal,
            keywords: 'behaviour animation sorting default view',
          },
          {
            id: 'appearance-language',
            routeName: 'settings-appearance-language',
            labelKey: 'settings.appearance.tabs.language',
            descriptionKey: 'settings.nav.descriptions.appearanceLanguage',
            icon: Globe,
            keywords: 'language locale translation region date format',
          },
        ],
      },
      {
        id: 'reader',
        routeName: 'settings-reader-ebook',
        labelKey: 'settings.common.nav.reader',
        icon: BookOpen,
        keywords: 'reading epub pdf comics audiobook fonts margins',
        children: [
          {
            id: 'reader-ebook',
            routeName: 'settings-reader-ebook',
            labelKey: 'settings.reader.tabs.ebook',
            descriptionKey: 'settings.nav.descriptions.readerEbook',
            icon: BookOpen,
            keywords: 'epub font size line height margins paged scroll',
          },
          {
            id: 'reader-pdf',
            routeName: 'settings-reader-pdf',
            labelKey: 'settings.reader.tabs.pdf',
            descriptionKey: 'settings.nav.descriptions.readerPdf',
            icon: FileText,
            keywords: 'pdf zoom text layer render page fit',
          },
          {
            id: 'reader-comics',
            routeName: 'settings-reader-comics',
            labelKey: 'settings.reader.tabs.comics',
            descriptionKey: 'settings.nav.descriptions.readerComics',
            icon: Image,
            keywords: 'cbz cbr manga webtoon reading direction spread',
          },
          {
            id: 'reader-audio',
            routeName: 'settings-reader-audio',
            labelKey: 'settings.reader.tabs.audio',
            descriptionKey: 'settings.nav.descriptions.readerAudio',
            icon: Headphones,
            keywords: 'audiobook playback speed skip sleep timer',
          },
          {
            id: 'reader-fonts',
            routeName: 'settings-reader-fonts',
            labelKey: 'settings.reader.tabs.fonts',
            descriptionKey: 'settings.nav.descriptions.readerFonts',
            icon: Type,
            keywords: 'font typeface family upload reader',
          },
          {
            id: 'reader-general',
            routeName: 'settings-reader-general',
            labelKey: 'settings.reader.tabs.general',
            descriptionKey: 'settings.nav.descriptions.readerGeneral',
            icon: SlidersHorizontal,
            keywords: 'resume progress sync screen awake defaults',
          },
        ],
      },
      {
        id: 'notifications',
        routeName: 'settings-notifications',
        labelKey: 'settings.account.tabs.notifications',
        descriptionKey: 'settings.nav.descriptions.notifications',
        icon: Bell,
        keywords: 'notify email digest alerts events',
        isVisible: (context) => !context.isDemoRestricted && (context.isSuperuser || context.permissions.includes(Permission.NotificationAccess)),
      },
      {
        id: 'privacy',
        routeName: 'settings-account-privacy',
        labelKey: 'settings.account.tabs.privacy',
        descriptionKey: 'settings.nav.descriptions.privacy',
        icon: Lock,
        keywords: 'privacy sharing public profile activity insights',
      },
      {
        id: 'restrictions',
        routeName: 'settings-account-restrictions',
        labelKey: 'settings.account.tabs.restrictions',
        descriptionKey: 'settings.nav.descriptions.restrictions',
        icon: Shield,
        keywords: 'restrict age rating mature hide content filter',
      },
    ],
  },
  {
    id: 'library',
    labelKey: 'settings.nav.groups.library',
    icon: Library,
    items: [
      {
        id: 'libraries',
        routeName: 'settings-libraries',
        labelKey: 'settings.common.nav.libraries',
        descriptionKey: 'settings.nav.descriptions.libraries',
        icon: Folder,
        keywords: 'library folder path scan watch ignore mount storage',
        status: 'libraryScan',
        isVisible: anyPermission('manage_libraries'),
      },
      {
        id: 'metadata',
        routeName: 'settings-metadata-providers',
        labelKey: 'settings.common.nav.metadata',
        icon: Database,
        keywords: 'metadata provider field rule score author genre custom field',
        children: [
          {
            id: 'metadata-providers',
            routeName: 'settings-metadata-providers',
            labelKey: 'settings.metadata.tabs.providers',
            descriptionKey: 'settings.metadata.tabSubtitles.providers',
            icon: Database,
            keywords: 'provider source google books open library comicvine priority credentials',
            isVisible: anyPermission('manage_metadata_config'),
          },
          {
            id: 'metadata-field-rules',
            routeName: 'settings-metadata-field-rules',
            labelKey: 'settings.metadata.tabs.field-rules',
            descriptionKey: 'settings.metadata.tabSubtitles.field-rules',
            icon: SlidersHorizontal,
            keywords: 'field rule merge strategy overwrite protect title author series',
            isVisible: anyPermission('manage_metadata_config'),
          },
          {
            id: 'metadata-custom-fields',
            routeName: 'settings-metadata-custom-fields',
            labelKey: 'settings.metadata.tabs.custom-fields',
            descriptionKey: 'settings.metadata.tabSubtitles.custom-fields',
            icon: Tag,
            keywords: 'custom field column attribute picker',
            isVisible: anyPermission('manage_libraries'),
          },
          {
            id: 'metadata-score',
            routeName: 'settings-metadata-score',
            labelKey: 'settings.metadata.tabs.score',
            descriptionKey: 'settings.metadata.tabSubtitles.score',
            icon: Star,
            keywords: 'score weight match confidence similarity threshold',
            isVisible: anyPermission('manage_metadata_config'),
          },
          {
            id: 'metadata-auto-fetch',
            routeName: 'settings-metadata-auto-fetch',
            labelKey: 'settings.metadata.tabs.auto-fetch',
            descriptionKey: 'settings.metadata.tabSubtitles.auto-fetch',
            icon: Zap,
            keywords: 'auto fetch schedule missing fields import books conditions',
            isVisible: anyPermission('manage_metadata_config'),
          },
          {
            id: 'metadata-authors',
            routeName: 'settings-metadata-authors',
            labelKey: 'settings.metadata.tabs.authors',
            descriptionKey: 'settings.metadata.tabSubtitles.authors',
            icon: Sparkles,
            keywords: 'author biography photo enrichment',
            isVisible: anyPermission('manage_metadata_config'),
          },
          {
            id: 'metadata-genre-blocklist',
            routeName: 'settings-metadata-genre-blocklist',
            labelKey: 'settings.metadata.tabs.genre-blocklist',
            descriptionKey: 'settings.metadata.tabSubtitles.genre-blocklist',
            icon: Filter,
            keywords: 'genre tag blocklist exclude ignore',
            isVisible: anyPermission('manage_metadata_config'),
          },
        ],
      },
      {
        id: 'file-naming',
        routeName: 'settings-file-naming',
        labelKey: 'settings.system.tabs.file-naming',
        descriptionKey: 'settings.nav.descriptions.fileNaming',
        icon: FileText,
        keywords: 'file naming pattern template rename folder structure',
        isVisible: anyPermission(Permission.ManageAppSettings),
      },
      {
        id: 'maintenance',
        routeName: 'settings-maintenance',
        labelKey: 'settings.system.tabs.maintenance',
        descriptionKey: 'settings.nav.descriptions.maintenance',
        icon: Wrench,
        keywords: 'scan maintenance duplicates orphans cleanup thumbnails cache',
        isVisible: anyPermission(Permission.ManageAppSettings),
      },
    ],
  },
  {
    id: 'devices',
    labelKey: 'settings.nav.groups.devices',
    icon: Smartphone,
    items: [
      {
        id: 'kobo',
        routeName: 'settings-kobo',
        labelKey: 'settings.common.nav.kobo',
        descriptionKey: 'settings.nav.descriptions.kobo',
        icon: Tablet,
        keywords: 'kobo sync device endpoint store proxy shelf shelves collections',
        isVisible: anyPermission(Permission.KoboSync),
      },
      {
        id: 'koreader',
        routeName: 'settings-koreader',
        labelKey: 'settings.common.nav.koreader',
        descriptionKey: 'settings.nav.descriptions.koreader',
        icon: Smartphone,
        keywords: 'koreader progress sync credentials position',
        isVisible: anyPermission(Permission.KoreaderSync),
      },
      {
        id: 'opds',
        routeName: 'settings-opds',
        labelKey: 'settings.common.nav.opds',
        descriptionKey: 'settings.nav.descriptions.opds',
        icon: Rss,
        keywords: 'opds feed catalog third party reader',
        isVisible: anyPermission('opds_access'),
      },
      {
        id: 'email',
        routeName: 'settings-email',
        labelKey: 'settings.common.nav.email',
        descriptionKey: 'settings.nav.descriptions.email',
        icon: Mail,
        keywords: 'email smtp kindle send to device template sender',
        isVisible: anyPermission('email_send', 'manage_email'),
      },
    ],
  },
  {
    id: 'accounts',
    labelKey: 'settings.nav.groups.accounts',
    icon: Link2,
    items: [
      {
        id: 'hardcover',
        routeName: 'settings-hardcover',
        labelKey: 'settings.integrations.tabs.hardcover',
        descriptionKey: 'settings.nav.descriptions.hardcover',
        icon: BookMarked,
        keywords: 'hardcover integration token reading status reviews',
        isVisible: anyPermission(Permission.HardcoverSync),
      },
      {
        id: 'readwise',
        routeName: 'settings-readwise',
        labelKey: 'settings.integrations.tabs.readwise',
        descriptionKey: 'settings.integrations.providerSubtitles.readwise',
        icon: Highlighter,
        keywords: 'readwise highlights notes export',
        isVisible: anyPermission(Permission.ReadwiseSync),
      },
      {
        id: 'storygraph',
        routeName: 'settings-storygraph',
        labelKey: 'settings.integrations.tabs.storygraph',
        descriptionKey: 'settings.integrations.providerSubtitles.storygraph',
        icon: LibraryBig,
        keywords: 'storygraph shelves progress mirror',
        isVisible: anyPermission(Permission.StorygraphSync),
      },
    ],
  },
  {
    id: 'server',
    labelKey: 'settings.nav.groups.server',
    icon: Server,
    items: [
      {
        id: 'users-access',
        routeName: 'settings-admin-users',
        labelKey: 'settings.common.nav.usersAccess',
        icon: ShieldUser,
        keywords: 'user role permission invite admin superuser sso login access',
        children: [
          {
            id: 'users',
            routeName: 'settings-admin-users',
            labelKey: 'settings.admin.tabs.users',
            descriptionKey: 'settings.nav.descriptions.users',
            icon: Users,
            keywords: 'user role permission invite admin superuser account',
            isVisible: anyPermission('manage_users'),
          },
          {
            id: 'account-activity',
            routeName: 'settings-admin-account-activity',
            labelKey: 'settings.admin.tabs.account-activity',
            descriptionKey: 'settings.nav.descriptions.accountActivity',
            icon: Activity,
            keywords: 'activity session login usage reading insights',
            isVisible: anyPermission('view_user_activity'),
          },
          {
            id: 'magic-links',
            routeName: 'settings-admin-magic-links',
            labelKey: 'settings.admin.tabs.magic-links',
            descriptionKey: 'settings.nav.descriptions.magicLinks',
            icon: KeyRound,
            keywords: 'magic link share passwordless expiry token invite',
            isVisible: superuserOnly,
          },
          {
            id: 'oidc',
            routeName: 'settings-admin-oidc',
            labelKey: 'settings.admin.tabs.oidc',
            descriptionKey: 'settings.nav.descriptions.oidc',
            icon: ShieldCheck,
            keywords: 'oidc sso single sign on auth provider claims',
            isVisible: anyPermission('manage_app_settings'),
          },
        ],
      },
      {
        id: 'requests',
        routeName: 'settings-admin-requests',
        labelKey: 'settings.system.tabs.requests',
        descriptionKey: 'settings.nav.descriptions.requests',
        icon: DownloadCloud,
        keywords: 'request download client qbittorrent torrent magnet path mapping hardlink',
        isVisible: anyPermission(Permission.ManageAppSettings),
      },
      {
        id: 'book-dock',
        routeName: 'settings-admin-book-dock',
        labelKey: 'settings.system.tabs.book-dock',
        descriptionKey: 'settings.nav.descriptions.bookDock',
        icon: PanelBottom,
        keywords: 'dock quick action book page toolbar',
        isVisible: anyPermission(Permission.ManageBookDock),
      },
      {
        id: 'server-fonts',
        routeName: 'settings-admin-server-fonts',
        labelKey: 'settings.admin.tabs.server-fonts',
        descriptionKey: 'settings.nav.descriptions.serverFonts',
        icon: Type,
        keywords: 'server font upload typeface available readers',
        isVisible: anyPermission('manage_app_settings'),
      },
      {
        id: 'audit-log',
        routeName: 'settings-admin-audit-log',
        labelKey: 'settings.system.tabs.audit-log',
        descriptionKey: 'settings.nav.descriptions.auditLog',
        icon: ScrollText,
        keywords: 'audit log history event change security',
        isVisible: superuserOnly,
      },
    ],
  },
]

function isItemVisible(item: SettingsNavItem, context: SettingsNavContext): boolean {
  return item.isVisible ? item.isVisible(context) : true
}

/** A grouping row is only a destination through its children, so it dies with the last of them. */
function visibleItem(item: SettingsNavItem, context: SettingsNavContext): SettingsNavItem | null {
  if (!isItemVisible(item, context)) return null
  if (!item.children) return item
  const children = item.children.filter((child) => isItemVisible(child, context))
  if (children.length === 0) return null
  return { ...item, children }
}

export function visibleSettingsNav(context: SettingsNavContext): SettingsNavGroup[] {
  return SETTINGS_NAV.map((group) => ({
    ...group,
    items: group.items.map((item) => visibleItem(item, context)).filter((item): item is SettingsNavItem => item !== null),
  })).filter((group) => group.items.length > 0)
}

export interface SettingsNavMatch {
  group: SettingsNavGroup
  item: SettingsNavItem
  parent?: SettingsNavItem
}

export function findSettingsNavItem(routeName: string | null | undefined): SettingsNavMatch | null {
  if (!routeName) return null
  for (const group of SETTINGS_NAV) {
    for (const item of group.items) {
      if (item.children) {
        const child = item.children.find((candidate) => candidate.routeName === routeName)
        if (child) return { group, item: child, parent: item }
      }
      if (item.routeName === routeName && !item.children) return { group, item }
    }
  }
  return null
}

/** First destination the user is actually allowed to open, used when a landing route has no target. */
export function firstVisibleSettingsRoute(context: SettingsNavContext): string {
  const groups = visibleSettingsNav(context)
  const item = groups[0]?.items[0]
  if (!item) return 'settings-account-profile'
  return item.children?.[0]?.routeName ?? item.routeName
}
