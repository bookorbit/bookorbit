// The /book/auto_complete endpoint returns book rows, but each row carries the
// contributing author's numeric id. It is not gated behind the AWS WAF
// challenge, so it is the cheap first hop for resolving a name to an author id.
export interface GoodreadsAuthorAutocompleteItem {
  author?: {
    id?: number | string;
    name?: string;
    profileUrl?: string;
  };
}

export interface GoodreadsAuthorRef {
  providerId: string;
  name: string;
}

export interface ParsedGoodreadsAuthor {
  name: string;
  description?: string;
  imageUrl?: string;
  birthDate?: string;
  birthYear?: number;
  deathDate?: string;
  deathYear?: number;
  website?: string;
  genres?: string[];
  influences?: string[];
}
