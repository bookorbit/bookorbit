const ARCHIVE_ENTRY_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function extensionIndex(path: string): number {
  const separator = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const dot = path.lastIndexOf('.');
  return dot > separator + 1 ? dot : path.length;
}

export function compareArchiveEntryNames(a: string, b: string): number {
  const aExtension = extensionIndex(a);
  const bExtension = extensionIndex(b);
  return (
    ARCHIVE_ENTRY_COLLATOR.compare(a.slice(0, aExtension), b.slice(0, bExtension)) ||
    ARCHIVE_ENTRY_COLLATOR.compare(a.slice(aExtension), b.slice(bExtension))
  );
}
