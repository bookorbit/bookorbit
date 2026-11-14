/**
 * A read-along EPUB holds one `cover-image`, which is the book's portrait cover. Its square
 * audiobook cover is the manifest image carrying Storyteller's `audio-cover-image` property, so
 * the same file serves Storyteller and BookOrbit.
 */
export const EPUB_AUDIO_COVER_PROPERTY = 'storyteller:audio-cover-image';

/** The prefix a package must declare, in its `prefix` attribute, for that property to be valid. */
export const EPUB_AUDIO_COVER_PREFIX = 'storyteller';
export const EPUB_AUDIO_COVER_PREFIX_IRI = 'https://storyteller-platform.gitlab.io/storyteller/docs/vocabulary';

/** The id and file stem Storyteller gives that image, reused when BookOrbit has to add it. */
export const EPUB_AUDIO_COVER_ITEM_ID = 'audio-cover-image';
export const EPUB_AUDIO_COVER_FILE_STEM = 'audio-cover';

/** Larger than any cover worth showing; bounds what a hostile archive can make a reader inflate. */
export const EPUB_AUDIO_COVER_MAX_BYTES = 32 * 1024 * 1024;
