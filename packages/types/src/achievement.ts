export type AchievementCategory = "reading" | "library" | "exploration" | "dedication" | "devices";

export type AchievementRarity = "common" | "rare" | "epic" | "legendary";

export const ACHIEVEMENT_CATEGORY_LABELS: Record<AchievementCategory, string> = {
  reading: "Reading",
  library: "Library",
  exploration: "Exploration",
  dedication: "Dedication",
  devices: "Devices",
};

export interface AchievementItem {
  key: string;
  groupKey: string | null;
  tier: number | null;
  category: AchievementCategory;
  name: string;
  description: string;
  iconName: string;
  rarity: AchievementRarity;
  threshold: number | null;
  hidden: boolean;
  sortOrder: number;
  earned: boolean;
  awardedAt: string | null;
  context: Record<string, unknown> | null;
  currentProgress: number | null;
}

export interface AchievementCategoryGroup {
  key: AchievementCategory;
  label: string;
  earnedCount: number;
  totalCount: number;
  achievements: AchievementItem[];
}

export interface AchievementCatalogueResponse {
  categories: AchievementCategoryGroup[];
  totalEarned: number;
  totalAvailable: number;
}
