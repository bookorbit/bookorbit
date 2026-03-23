export interface ComicVineApiResponse<T> {
  error: string;
  limit: number;
  offset: number;
  number_of_page_results: number;
  number_of_total_results: number;
  status_code: number;
  results: T;
  version: string;
}

export interface ComicVineImage {
  original_url: string;
  medium_url?: string;
}

export interface ComicVinePublisher {
  id: number;
  name: string;
}

export interface ComicVineVolume {
  id: number;
  name: string;
  start_year: string | null;
  count_of_issues: number;
  description: string | null;
  deck: string | null;
  image: ComicVineImage | null;
  publisher: ComicVinePublisher | null;
  site_detail_url: string | null;
}

export interface ComicVineIssueVolume {
  id: number;
  name: string;
}

export interface ComicVinePersonCredit {
  id: number;
  name: string;
  role: string;
}

export interface ComicVineCredit {
  id: number;
  name: string;
}

export interface ComicVineIssue {
  id: number;
  name: string | null;
  issue_number: string;
  cover_date: string | null;
  store_date: string | null;
  description: string | null;
  deck: string | null;
  image: ComicVineImage | null;
  volume: ComicVineIssueVolume;
  site_detail_url: string | null;
  person_credits: ComicVinePersonCredit[];
  character_credits: ComicVineCredit[];
  team_credits: ComicVineCredit[];
  story_arc_credits: ComicVineCredit[];
  location_credits: ComicVineCredit[];
}
