import { Injectable } from '@nestjs/common';

import { BookEmbeddingSourceData } from './book-embedding.types';

export const EMBEDDING_DIMENSIONS = 256;

const MAX_DESCRIPTION_TOKENS = 100;
const MIN_TOKEN_LENGTH = 2;

const FEATURE_WEIGHTS = {
  seriesName: 3.0,
  author: 1.0,
  genre: 4.0,
  tag: 3.5,
  title: 3.0,
  publisher: 2.0,
  description: 1.0,
} as const;

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'in',
  'to',
  'for',
  'is',
  'it',
  'on',
  'at',
  'by',
  'with',
  'as',
  'be',
  'this',
  'that',
  'are',
  'was',
  'were',
  'has',
  'have',
  'had',
  'not',
  'but',
  'from',
  'can',
  'all',
  'so',
  'if',
  'no',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'do',
  'does',
  'did',
  'been',
  'being',
  'into',
  'out',
  'up',
  'one',
  'two',
  'more',
  'most',
  'also',
  'just',
  'about',
  'after',
  'its',
]);

@Injectable()
export class BookEmbeddingVectorizerService {
  buildVector(params: BookEmbeddingSourceData): number[] {
    const accumulator = new Float64Array(EMBEDDING_DIMENSIONS);

    const addExact = (text: string, weight: number) => {
      const normalized = text.toLowerCase().trim();
      if (normalized.length === 0) return;
      accumulator[this.fnv32(normalized) % EMBEDDING_DIMENSIONS] += weight;
    };

    const addTokens = (text: string, weight: number, maxTokens = Number.POSITIVE_INFINITY) => {
      for (const token of this.tokenize(text, maxTokens)) {
        accumulator[this.fnv32(token) % EMBEDDING_DIMENSIONS] += weight;
      }
    };

    if (params.seriesName) addExact(params.seriesName, FEATURE_WEIGHTS.seriesName);
    for (const authorName of params.authors) addExact(authorName, FEATURE_WEIGHTS.author);
    for (const genreName of params.genres) addExact(genreName, FEATURE_WEIGHTS.genre);
    for (const tagName of params.tags) addExact(tagName, FEATURE_WEIGHTS.tag);
    if (params.title) addTokens(params.title, FEATURE_WEIGHTS.title);
    if (params.publisher) addExact(params.publisher, FEATURE_WEIGHTS.publisher);
    if (params.description) addTokens(params.description, FEATURE_WEIGHTS.description, MAX_DESCRIPTION_TOKENS);

    return this.l2normalize(Array.from(accumulator));
  }

  private tokenize(text: string, maxTokens: number): string[] {
    const tokens: string[] = [];

    for (const match of text.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
      const token = match[0];
      if (token.length < MIN_TOKEN_LENGTH || STOPWORDS.has(token)) continue;

      tokens.push(token);
      if (tokens.length >= maxTokens) break;
    }

    return tokens;
  }

  private fnv32(text: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash;
  }

  private l2normalize(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (norm === 0) return vector;
    return vector.map((value) => value / norm);
  }
}
