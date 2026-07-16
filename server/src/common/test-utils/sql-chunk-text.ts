/**
 * Renders the plain-text SQL for a drizzle-orm `SQL` template (e.g. from `sql\`...\``)
 * so tests can assert on the generated query without a live database connection.
 */
export function sqlChunkText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const chunks = (value as { queryChunks?: unknown[] }).queryChunks;
  if (!Array.isArray(chunks)) return '';
  return chunks
    .map((chunk) => {
      if (!chunk || typeof chunk !== 'object') return '';
      const text = (chunk as { value?: unknown }).value;
      if (Array.isArray(text)) return text.join('');
      return sqlChunkText(chunk);
    })
    .join('');
}
