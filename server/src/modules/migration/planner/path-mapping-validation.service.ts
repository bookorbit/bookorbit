import { Injectable } from '@nestjs/common';

import type { SourceBook } from '../adapters/source-adapter.types';
import { MigrationRepository } from '../migration.repository';
import type { PathMapping } from './planner.types';

interface MappedPathRow {
  sourcePath: string;
  mappedPath: string;
  mappingIndex: number | null;
}

export interface MappingStats {
  sourcePrefix: string;
  targetPrefix: string;
  affectedBooks: number;
  matchedTargetPaths: number;
  unmatchedTargetPaths: number;
  unmatchedSamples: string[];
}

@Injectable()
export class PathMappingValidationService {
  constructor(private readonly repo: MigrationRepository) {}

  async validate(params: { sourceBooks: SourceBook[]; pathMappings: PathMapping[]; sampleLimit?: number }): Promise<{
    summary: {
      totalSourceBooks: number;
      booksWithFilePath: number;
      mappedByPrefix: number;
      matchedTargetPaths: number;
      unmatchedTargetPaths: number;
      unchangedPaths: number;
    };
    mappings: MappingStats[];
  }> {
    const sampleLimit = Math.min(Math.max(params.sampleLimit ?? 10, 1), 100);
    const mappings = normalizeMappings(params.pathMappings);

    const filePathRows: string[] = [];
    for (const book of params.sourceBooks) {
      const path = normalizePath(book.filePath);
      if (path) filePathRows.push(path);
    }

    const mappedRows: MappedPathRow[] = filePathRows.map((sourcePath) => {
      const matched = findMatchingMapping(sourcePath, mappings);
      if (matched) {
        return {
          sourcePath,
          mappedPath: `${matched.mapping.targetPrefix}${sourcePath.slice(matched.mapping.sourcePrefix.length)}`,
          mappingIndex: matched.index,
        };
      }
      return {
        sourcePath,
        mappedPath: sourcePath,
        mappingIndex: null,
      };
    });

    const existingTargetPaths = await this.repo.findExistingBookFilePaths(mappedRows.map((row) => row.mappedPath));

    const mappingStats: MappingStats[] = mappings.map((mapping) => ({
      sourcePrefix: mapping.sourcePrefix,
      targetPrefix: mapping.targetPrefix,
      affectedBooks: 0,
      matchedTargetPaths: 0,
      unmatchedTargetPaths: 0,
      unmatchedSamples: [],
    }));

    let mappedByPrefix = 0;
    let matchedTargetPaths = 0;
    let unmatchedTargetPaths = 0;
    let unchangedPaths = 0;

    for (const row of mappedRows) {
      if (row.mappingIndex == null) {
        unchangedPaths += 1;
      } else {
        mappedByPrefix += 1;
        const stats = mappingStats[row.mappingIndex];
        stats.affectedBooks += 1;
      }

      const isMatched = existingTargetPaths.has(row.mappedPath);
      if (isMatched) {
        matchedTargetPaths += 1;
        if (row.mappingIndex != null) {
          mappingStats[row.mappingIndex].matchedTargetPaths += 1;
        }
      } else {
        unmatchedTargetPaths += 1;
        if (row.mappingIndex != null) {
          const stats = mappingStats[row.mappingIndex];
          stats.unmatchedTargetPaths += 1;
          if (stats.unmatchedSamples.length < sampleLimit) {
            stats.unmatchedSamples.push(row.mappedPath);
          }
        }
      }
    }

    return {
      summary: {
        totalSourceBooks: params.sourceBooks.length,
        booksWithFilePath: filePathRows.length,
        mappedByPrefix,
        matchedTargetPaths,
        unmatchedTargetPaths,
        unchangedPaths,
      },
      mappings: mappingStats,
    };
  }
}

function findMatchingMapping(sourcePath: string, mappings: PathMapping[]): { index: number; mapping: PathMapping } | null {
  for (const [index, mapping] of mappings.entries()) {
    if (sourcePath.startsWith(mapping.sourcePrefix)) {
      return { index, mapping };
    }
  }
  return null;
}

function normalizeMappings(pathMappings: PathMapping[]): PathMapping[] {
  const normalized = pathMappings
    .map((row) => ({
      sourcePrefix: normalizePath(row.sourcePrefix),
      targetPrefix: normalizePath(row.targetPrefix),
    }))
    .filter((row): row is PathMapping => !!row.sourcePrefix && !!row.targetPrefix)
    .sort((a, b) => b.sourcePrefix.length - a.sourcePrefix.length);

  const deduped: PathMapping[] = [];
  const seen = new Set<string>();

  for (const mapping of normalized) {
    const key = `${mapping.sourcePrefix}|${mapping.targetPrefix}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(mapping);
  }

  return deduped;
}

function normalizePath(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}
