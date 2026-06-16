import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, serial, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';

import { users } from './auth';

export const achievements = pgTable(
  'achievements',
  {
    key: varchar('key', { length: 64 }).primaryKey(),
    groupKey: varchar('group_key', { length: 64 }),
    tier: integer('tier'),
    category: varchar('category', { length: 20 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    description: varchar('description', { length: 500 }).notNull(),
    iconName: varchar('icon_name', { length: 50 }).notNull(),
    rarity: varchar('rarity', { length: 20 }).notNull(),
    threshold: integer('threshold'),
    hidden: boolean('hidden').notNull().default(false),
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [
    index('achievements_category_sort_idx').on(t.category, t.sortOrder),
    index('achievements_group_key_idx').on(t.groupKey),
    check('achievements_category_chk', sql`${t.category} in ('reading', 'library', 'exploration', 'dedication', 'devices')`),
    check('achievements_rarity_chk', sql`${t.rarity} in ('common', 'rare', 'epic', 'legendary')`),
    check('achievements_tier_chk', sql`${t.tier} is null or (${t.tier} >= 1 and ${t.tier} <= 4)`),
  ],
);

export type AchievementRow = typeof achievements.$inferSelect;
export type NewAchievement = typeof achievements.$inferInsert;

export const userAchievements = pgTable(
  'user_achievements',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    achievementKey: varchar('achievement_key', { length: 64 })
      .notNull()
      .references(() => achievements.key, { onDelete: 'cascade' }),
    awardedAt: timestamp('awarded_at', { withTimezone: true }).notNull().defaultNow(),
    contextJson: jsonb('context_json'),
  },
  (t) => [
    uniqueIndex('user_achievements_user_key_uidx').on(t.userId, t.achievementKey),
    index('user_achievements_user_id_idx').on(t.userId),
    index('user_achievements_user_awarded_at_idx').on(t.userId, t.awardedAt),
  ],
);

export type UserAchievementRow = typeof userAchievements.$inferSelect;
export type NewUserAchievement = typeof userAchievements.$inferInsert;
