import type { NamingTarget } from './naming-rules'
import type { OrganizationMode } from '@bookorbit/types'

/**
 * Ready-made patterns, so a first-time user can get a sensible layout without learning
 * the grammar. Every one guards its segments with `<...|fallback>`, because an unguarded
 * token that resolves to nothing leaves an empty folder in the path.
 *
 * Folder-as-Book needs the book's own folder plus a filename inside it, so the two upload
 * variants are written out rather than derived: appending a suffix to the file variant
 * silently breaks recipes that end in an optional group.
 */
export interface PatternRecipe {
  id: string
  icon: string
  target: NamingTarget
  patterns: Record<OrganizationMode, string> | null
  downloadPattern: string | null
}

const FILE_STEM = '<{seriesIndex}. ><{title}|{originalFilename}>< ({year})>'

export const UPLOAD_RECIPES: PatternRecipe[] = [
  {
    id: 'seriesShelf',
    icon: 'Library',
    target: 'upload',
    patterns: {
      book_per_file: `<{authors:first}|Unknown Author>/<{series}/>${FILE_STEM}`,
      book_per_folder: `<{authors:first}|Unknown Author>/<{series}/>${FILE_STEM}/${FILE_STEM}`,
    },
    downloadPattern: null,
  },
  {
    id: 'calibre',
    icon: 'BookOpen',
    target: 'upload',
    patterns: {
      book_per_file: '<{authors}|Unknown Author>/<{title}|{originalFilename}>< ({year})>',
      book_per_folder: '<{authors}|Unknown Author>/<{title}|{originalFilename}>< ({year})>/<{title}|{originalFilename}>< ({year})>',
    },
    downloadPattern: null,
  },
  {
    id: 'alphabetical',
    icon: 'ArrowDownAZ',
    target: 'upload',
    patterns: {
      book_per_file: '<{authors:initial}|_>/<{authors:sort}|Unknown Author>/<{series}/><{seriesIndex}. ><{title}|{originalFilename}>',
      book_per_folder:
        '<{authors:initial}|_>/<{authors:sort}|Unknown Author>/<{series}/><{seriesIndex}. ><{title}|{originalFilename}>/<{seriesIndex}. ><{title}|{originalFilename}>',
    },
    downloadPattern: null,
  },
  {
    id: 'flat',
    icon: 'File',
    target: 'upload',
    patterns: {
      book_per_file: '<{authors:first} - ><{title}|{originalFilename}>< ({year})>',
      book_per_folder: '<{authors:first} - ><{title}|{originalFilename}>< ({year})>/<{title}|{originalFilename}>',
    },
    downloadPattern: null,
  },
]

export const DOWNLOAD_RECIPES: PatternRecipe[] = [
  { id: 'originalName', icon: 'File', target: 'download', patterns: null, downloadPattern: '{originalFilename}' },
  {
    id: 'authorTitle',
    icon: 'BookOpen',
    target: 'download',
    patterns: null,
    downloadPattern: '<{authors:first} - ><{title}|{originalFilename}>< ({year})>',
  },
  { id: 'titleOnly', icon: 'Type', target: 'download', patterns: null, downloadPattern: '<{title}|{originalFilename}>< ({year})>' },
  {
    id: 'seriesOrdered',
    icon: 'Library',
    target: 'download',
    patterns: null,
    downloadPattern: '<{series} ><{seriesIndex} - ><{title}|{originalFilename}>',
  },
]

export function recipesFor(target: NamingTarget): PatternRecipe[] {
  return target === 'download' ? DOWNLOAD_RECIPES : UPLOAD_RECIPES
}

export function recipePattern(recipe: PatternRecipe, mode: OrganizationMode | null): string {
  if (recipe.target === 'download') return recipe.downloadPattern ?? ''
  return recipe.patterns?.[mode ?? 'book_per_file'] ?? ''
}
