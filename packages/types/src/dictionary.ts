export interface DictionaryDefinition {
  definition: string;
  example?: string | null;
}

export interface DictionaryEntry {
  partOfSpeech: string;
  definitions: DictionaryDefinition[];
  /**
   * The word these senses actually define. Differs from the looked-up word when
   * the lookup followed an inflection pointer ("plural of candelabra") to reach
   * a word that carries a real definition.
   */
  sourceWord: string;
}

export interface DictionaryResult {
  word: string;
  phonetic: string | null;
  audioUrl: string | null;
  entries: DictionaryEntry[];
  provider: "free-dictionary" | "wiktionary";
}
