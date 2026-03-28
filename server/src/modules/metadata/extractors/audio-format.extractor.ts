import { extractAudioMetadata } from './audio.extractor';
import type { FormatExtractor, ParsedBookData } from './format-extractor.interface';

export class AudioFormatExtractor implements FormatExtractor {
  async extract(absolutePath: string): Promise<ParsedBookData | null> {
    const audio = await extractAudioMetadata(absolutePath);
    return {
      title: audio.title,
      description: audio.description,
      publisher: audio.publisher,
      publishedYear: audio.publishedYear,
      language: audio.language,
      authors: audio.authors,
      genres: [],
      cover: audio.coverBytes,
      narrators: audio.narrators,
      durationSeconds: audio.durationSeconds,
      chapters: audio.chapters,
    };
  }
}
