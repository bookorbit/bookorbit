import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const scriptDirectory = import.meta.dirname ?? path.join(process.cwd(), 'scripts')
const clientRoot = path.resolve(scriptDirectory, '..')

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') return []
        return sourceFiles(entryPath)
      }
      return entry.isFile() && /\.(ts|vue)$/.test(entry.name) && !/\.(spec|test)\.ts$/.test(entry.name) ? [entryPath] : []
    }),
  )
  return files.flat()
}

export async function collectSourceMessageKeys(sourceDirectory = path.join(clientRoot, 'src')) {
  const files = await sourceFiles(sourceDirectory)
  const keys = new Set()
  const slotCountKeys = new Set()

  for (const file of files) {
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(/(?<![\w$])(?:\$?t|\$?tc|\$?te)\(\s*(['"])([A-Za-z0-9_.-]+)\1/g)) {
      keys.add(match[2])
    }
    for (const match of source.matchAll(/<i18n-t\b[^>]*\bkeypath\s*=\s*(['"])([A-Za-z0-9_.-]+)\1/g)) {
      keys.add(match[2])
    }
    for (const match of source.matchAll(/<IcuCountText\b[^>]*\bkeypath\s*=\s*(['"])([A-Za-z0-9_.-]+)\1/g)) {
      keys.add(match[2])
      slotCountKeys.add(match[2])
    }
  }

  return { keys, slotCountKeys }
}
