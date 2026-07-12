import { extractAudioMetadata } from './audio.extractor';
import type { FormatExtractor, ParsedBookData } from './format-extractor.interface';

export class AudioFormatExtractor implements FormatExtractor {
  async extract(absolutePath: string): Promise<ParsedBookData | null> {
    const audio = await extractAudioMetadata(absolutePath);
    return {
      title: audio.title,
      subtitle: audio.subtitle,
      description: audio.description,
      publisher: audio.publisher,
      publishedDate: audio.publishedDate,
      publishedYear: audio.publishedYear,
      language: audio.language,
      seriesName: audio.seriesName,
      seriesIndex: audio.seriesIndex,
      authors: audio.authors,
      genres: audio.genres,
      audibleId: audio.audibleId,
      librofmId: audio.librofmId,
      cover: audio.coverBytes,
      narrators: audio.narrators,
      durationSeconds: audio.durationSeconds,
      chapters: audio.chapters,
    };
  }
}
