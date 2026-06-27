export interface AudibleCategoryLadder {
  ladder: Array<{ id: string; name: string }>;
}

export interface AudibleProduct {
  asin: string;
  title: string;
  subtitle?: string;
  authors?: Array<{ name: string }>;
  narrators?: Array<{ name: string }>;
  publisher_name?: string;
  release_date?: string;
  language?: string;
  runtime_length_min?: number;
  format_type?: string;
  product_images?: { 500?: string; 1024?: string };
  publisher_summary?: string;
  merchandising_summary?: string;
  series?: Array<{ asin?: string; title: string; sequence?: string; url?: string }>;
  category_ladders?: AudibleCategoryLadder[];
  rating?: {
    overall_distribution?: {
      average_rating?: number;
      num_ratings?: number;
    };
  };
}

export interface AudibleSearchResponse {
  products: AudibleProduct[];
  total_results?: number;
}
