export const BOOKLORE_TABLES = {
  annotations: 'annotations',
  author: 'author',
  book: 'book',
  bookFile: 'book_file',
  bookMarks: 'book_marks',
  bookMetadata: 'book_metadata',
  bookMetadataAuthorMapping: 'book_metadata_author_mapping',
  bookMetadataCategoryMapping: 'book_metadata_category_mapping',
  bookMetadataTagMapping: 'book_metadata_tag_mapping',
  bookNotes: 'book_notes',
  bookNotesV2: 'book_notes_v2',
  bookShelfMapping: 'book_shelf_mapping',
  category: 'category',
  cbxViewerPreference: 'cbx_viewer_preference',
  comicMetadata: 'comic_metadata',
  ebookViewerPreference: 'ebook_viewer_preference',
  epubViewerPreference: 'epub_viewer_preference',
  koboReadingState: 'kobo_reading_state',
  koboUserSettings: 'kobo_user_settings',
  libraryPath: 'library_path',
  newPdfViewerPreference: 'new_pdf_viewer_preference',
  pdfAnnotations: 'pdf_annotations',
  pdfViewerPreference: 'pdf_viewer_preference',
  shelf: 'shelf',
  tag: 'tag',
  userBookFileProgress: 'user_book_file_progress',
  userBookProgress: 'user_book_progress',
  users: 'users',
} as const;

const BOOKLORE_MIGRATION_TABLE_NAME_SET = new Set<string>(Object.values(BOOKLORE_TABLES));

export function isBookloreMigrationTableName(tableName: string): boolean {
  return BOOKLORE_MIGRATION_TABLE_NAME_SET.has(tableName.toLowerCase());
}
