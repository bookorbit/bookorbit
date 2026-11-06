import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Plugin } from 'vite'
import { guessLucideFileName, isLucidePickerName } from '../src/lib/lucide-icon-name'

/**
 * Serves every Lucide icon as its own small SVG file, plus one catalog of all of them for the icon
 * picker, so a page that shows a stored icon name downloads that icon instead of the whole set.
 * Interface icons keep their named `@lucide/vue` imports; this covers names only known at runtime.
 */

type IconNode = [tag: string, attrs: Record<string, string | number>, children?: IconNode[]]

interface IconData {
  name: string
  size?: number
  node: IconNode[]
}

interface LucideIconSet {
  version: string
  symbols: Map<string, string>
  pickerNames: string[]
  aliases: Record<string, string>
}

const INDEX_MODULE = 'virtual:lucide-icon-index'
const NAMES_MODULE = 'virtual:lucide-icon-names'
const CATALOG_FILE = 'catalog'
const EXPORT_LINE = /export \{([^}]*)\} from '\.\/icons\/([a-z0-9-]+)\.mjs';/g
const DEFAULT_EXPORT = /default as (\w+)/g
const DEV_ICON_URL = /^\/assets\/lucide\/([^/]+)\/([a-z0-9-]+)\.svg(?:\?.*)?$/

function escapeAttribute(value: string | number): string {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function renderNode([tag, attrs, children]: IconNode): string {
  const attributes = Object.entries(attrs)
    .filter(([name]) => name !== 'key')
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join('')
  const inner = children?.map(renderNode).join('') ?? ''
  return inner ? `<${tag}${attributes}>${inner}</${tag}>` : `<${tag}${attributes}/>`
}

function renderSymbol(file: string, data: IconData): string {
  const size = data.size ?? 24
  return `<symbol id="${file}" viewBox="0 0 ${size} ${size}">${data.node.map(renderNode).join('')}</symbol>`
}

function svgDocument(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`
}

async function loadLucideIconSet(root: string): Promise<LucideIconSet> {
  const require = createRequire(join(root, 'package.json'))
  const packageJsonPath = require.resolve('@lucide/vue/package.json')
  const { version } = JSON.parse(await readFile(packageJsonPath, 'utf8')) as { version: string }
  const esmDir = join(dirname(packageJsonPath), 'dist', 'esm')
  const indexSource = await readFile(join(esmDir, 'lucide-vue.mjs'), 'utf8')

  const fileByName = new Map<string, string>()
  for (const [, specifiers = '', file = ''] of indexSource.matchAll(EXPORT_LINE)) {
    for (const [, name = ''] of specifiers.matchAll(DEFAULT_EXPORT)) fileByName.set(name, file)
  }
  const files = [...new Set(fileByName.values())].sort()
  if (files.length === 0) throw new Error(`No icon exports found in @lucide/vue ${version}; the index format changed.`)
  if (files.includes(CATALOG_FILE))
    throw new Error(`@lucide/vue ${version} has an icon named "${CATALOG_FILE}", which clashes with the catalog file.`)

  const rendered = await Promise.all(
    files.map(async (file) => {
      const iconModule = (await import(pathToFileURL(join(esmDir, 'icons', `${file}.mjs`)).href)) as { __iconData?: IconData }
      if (!iconModule.__iconData) throw new Error(`@lucide/vue ${version} icon "${file}" has no __iconData export.`)
      return [file, renderSymbol(file, iconModule.__iconData)] as const
    }),
  )
  const symbols = new Map<string, string>(rendered)

  const pickerNames = [...fileByName.keys()].filter(isLucidePickerName).sort()
  const aliases: Record<string, string> = {}
  for (const name of pickerNames) {
    const file = fileByName.get(name)!
    if (guessLucideFileName(name) !== file) aliases[name] = file
  }

  return { version, symbols, pickerNames, aliases }
}

export function lucideIconsPlugin(): Plugin {
  let root = process.cwd()
  let iconSet: Promise<LucideIconSet> | undefined
  const loadIconSet = () => (iconSet ??= loadLucideIconSet(root))

  return {
    name: 'bookorbit:lucide-icons',
    configResolved(config) {
      root = config.root
    },
    resolveId(id) {
      if (id === INDEX_MODULE || id === NAMES_MODULE) return `\0${id}`
      return null
    },
    async load(id) {
      if (id === `\0${INDEX_MODULE}`) {
        const { version, symbols, aliases } = await loadIconSet()
        return [
          `export const LUCIDE_VERSION = ${JSON.stringify(version)}`,
          `export const LUCIDE_ICON_FILES = ${JSON.stringify([...symbols.keys()].join(' '))}.split(' ')`,
          `export const LUCIDE_ICON_ALIASES = ${JSON.stringify(aliases)}`,
        ].join('\n')
      }
      if (id === `\0${NAMES_MODULE}`) {
        const { pickerNames } = await loadIconSet()
        return `export const LUCIDE_PICKER_NAMES = ${JSON.stringify(pickerNames.join(' '))}.split(' ')`
      }
      return null
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = req.url?.match(DEV_ICON_URL)
        if (!match) return next()
        const [, version, file] = match
        loadIconSet()
          .then((set) => {
            const body =
              version !== set.version ? undefined : file === CATALOG_FILE ? [...set.symbols.values()].join('') : set.symbols.get(file ?? '')
            if (body === undefined) {
              res.statusCode = 404
              res.end()
              return
            }
            res.setHeader('Content-Type', 'image/svg+xml')
            res.setHeader('Cache-Control', 'no-cache')
            res.end(svgDocument(body))
          })
          .catch(next)
      })
    },
    async generateBundle() {
      const { version, symbols } = await loadIconSet()
      const folder = `assets/lucide/${version}`
      for (const [file, symbol] of symbols) {
        this.emitFile({ type: 'asset', fileName: `${folder}/${file}.svg`, source: svgDocument(symbol) })
      }
      this.emitFile({ type: 'asset', fileName: `${folder}/${CATALOG_FILE}.svg`, source: svgDocument([...symbols.values()].join('')) })
    },
  }
}
