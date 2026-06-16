import { Injectable } from '@nestjs/common';

import { AchievementRepository } from '../achievement.repository';
import {
  ACHIEVEMENT_EVENT_ANNOTATION_CREATED,
  ACHIEVEMENT_EVENT_BACKFILL,
  ACHIEVEMENT_EVENT_COLLECTION_CREATED,
  ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED,
  ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED,
  type BookStatusChangedPayload,
  type AnnotationCreatedPayload,
} from '../achievement-events.service';
import type { AchievementAward, EvaluationContext, IAchievementEvaluator } from './evaluator.interface';

const LIBRARY_BUILDER_TIERS = [
  { key: 'library_builder_1', threshold: 50 },
  { key: 'library_builder_2', threshold: 250 },
  { key: 'library_builder_3', threshold: 1000 },
  { key: 'library_builder_4', threshold: 5000 },
];

const ANNOTATOR_TIERS = [
  { key: 'annotator_1', threshold: 10 },
  { key: 'annotator_2', threshold: 50 },
  { key: 'annotator_3', threshold: 200 },
  { key: 'annotator_4', threshold: 500 },
];

const NOTE_KEEPER_THRESHOLD = 25;
const DEEP_DIVE_SESSION_THRESHOLD = 10;
const WORDSMITH_MIN_LENGTH = 280;
const BOX_OF_CRAYONS_COLORS = 5;

@Injectable()
export class LibraryEvaluator implements IAchievementEvaluator {
  constructor(private readonly repo: AchievementRepository) {}

  supports(eventName: string): boolean {
    return (
      eventName === ACHIEVEMENT_EVENT_ANNOTATION_CREATED ||
      eventName === ACHIEVEMENT_EVENT_BACKFILL ||
      eventName === ACHIEVEMENT_EVENT_COLLECTION_CREATED ||
      eventName === ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED ||
      eventName === ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED
    );
  }

  async evaluate(ctx: EvaluationContext, earnedKeys: Set<string>): Promise<AchievementAward[]> {
    const awards: AchievementAward[] = [];

    if (ctx.eventName === ACHIEVEMENT_EVENT_ANNOTATION_CREATED) {
      const payload = ctx.payload as unknown as AnnotationCreatedPayload;
      await this.evaluateAnnotatorTiers(ctx.userId, earnedKeys, awards);
      await this.evaluateNoteKeeper(ctx.userId, earnedKeys, awards);
      await this.evaluateDeepDiveSession(ctx.userId, payload, earnedKeys, awards);
      await this.evaluateWordsmith(ctx.userId, payload, earnedKeys, awards);
      await this.evaluateBoxOfCrayons(ctx.userId, earnedKeys, awards);
    }

    if (ctx.eventName === ACHIEVEMENT_EVENT_COLLECTION_CREATED) {
      await this.evaluateCurator(ctx.userId, earnedKeys, awards);
    }

    if (ctx.eventName === ACHIEVEMENT_EVENT_BOOK_STATUS_CHANGED) {
      const payload = ctx.payload as unknown as BookStatusChangedPayload;
      if (payload.newStatus === 'read') {
        await this.evaluateLibraryBuilderTiers(ctx.userId, ctx.isSuperuser, earnedKeys, awards);
        await this.evaluateMultiFormat(ctx.userId, ctx.isSuperuser, earnedKeys, awards);
      }
    }

    if (ctx.eventName === ACHIEVEMENT_EVENT_LIBRARY_CATALOG_CHANGED) {
      await this.evaluateLibraryBuilderTiers(ctx.userId, ctx.isSuperuser, earnedKeys, awards);
      await this.evaluateMultiFormat(ctx.userId, ctx.isSuperuser, earnedKeys, awards);
    }

    if (ctx.eventName === ACHIEVEMENT_EVENT_BACKFILL) {
      await this.evaluateAnnotatorTiers(ctx.userId, earnedKeys, awards);
      await this.evaluateCurator(ctx.userId, earnedKeys, awards);
      await this.evaluateLibraryBuilderTiers(ctx.userId, ctx.isSuperuser, earnedKeys, awards);
      await this.evaluateMultiFormat(ctx.userId, ctx.isSuperuser, earnedKeys, awards);
      await this.evaluateNoteKeeper(ctx.userId, earnedKeys, awards);
      await this.evaluateDeepDiveSessionBackfill(ctx.userId, earnedKeys, awards);
      await this.evaluateWordsmithBackfill(ctx.userId, earnedKeys, awards);
      await this.evaluateBoxOfCrayons(ctx.userId, earnedKeys, awards);
    }

    return awards;
  }

  private async evaluateLibraryBuilderTiers(
    userId: number,
    isSuperuser: boolean,
    earnedKeys: Set<string>,
    awards: AchievementAward[],
  ): Promise<void> {
    const unearnedTiers = LIBRARY_BUILDER_TIERS.filter((t) => !earnedKeys.has(t.key));
    if (unearnedTiers.length === 0) return;

    const count = await this.repo.countAccessibleBooks(userId, isSuperuser);

    for (const tier of unearnedTiers) {
      if (count >= tier.threshold) {
        awards.push({ key: tier.key, context: { count } });
      }
    }
  }

  private async evaluateAnnotatorTiers(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    const unearnedTiers = ANNOTATOR_TIERS.filter((t) => !earnedKeys.has(t.key));
    if (unearnedTiers.length === 0) return;

    const count = await this.repo.countAnnotations(userId);

    for (const tier of unearnedTiers) {
      if (count >= tier.threshold) {
        awards.push({ key: tier.key, context: { count } });
      }
    }
  }

  private async evaluateMultiFormat(userId: number, isSuperuser: boolean, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('multi_format')) return;
    const formatCount = await this.repo.countDistinctFormats(userId, isSuperuser);
    if (formatCount >= 3) {
      awards.push({ key: 'multi_format', context: { formatCount } });
    }
  }

  private async evaluateCurator(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('curator')) return;
    const count = await this.repo.countCollections(userId);
    if (count >= 10) {
      awards.push({ key: 'curator', context: { count } });
    }
  }

  private async evaluateNoteKeeper(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('note_keeper')) return;
    const count = await this.repo.countAnnotationsWithNotes(userId);
    if (count >= NOTE_KEEPER_THRESHOLD) {
      awards.push({ key: 'note_keeper', context: { count } });
    }
  }

  private async evaluateDeepDiveSession(
    userId: number,
    payload: AnnotationCreatedPayload,
    earnedKeys: Set<string>,
    awards: AchievementAward[],
  ): Promise<void> {
    if (earnedKeys.has('deep_dive_session')) return;
    const today = new Date();
    const count = await this.repo.countAnnotationsOnDay(userId, today);
    if (count >= DEEP_DIVE_SESSION_THRESHOLD) {
      awards.push({ key: 'deep_dive_session', context: { count, bookId: payload.bookId } });
    }
  }

  private async evaluateDeepDiveSessionBackfill(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('deep_dive_session')) return;
    const hasDay = await this.repo.hasAnyDayWithAnnotationCount(userId, DEEP_DIVE_SESSION_THRESHOLD);
    if (hasDay) {
      awards.push({ key: 'deep_dive_session', context: {} });
    }
  }

  private async evaluateWordsmith(
    userId: number,
    payload: AnnotationCreatedPayload,
    earnedKeys: Set<string>,
    awards: AchievementAward[],
  ): Promise<void> {
    if (earnedKeys.has('wordsmith')) return;
    const length = await this.repo.getAnnotationNoteLength(payload.annotationId, userId);
    if (length !== null && length > WORDSMITH_MIN_LENGTH) {
      awards.push({ key: 'wordsmith', context: { length, bookId: payload.bookId } });
    }
  }

  private async evaluateWordsmithBackfill(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('wordsmith')) return;
    const maxLength = await this.repo.getMaxNoteLength(userId);
    if (maxLength > WORDSMITH_MIN_LENGTH) {
      awards.push({ key: 'wordsmith', context: { length: maxLength } });
    }
  }

  private async evaluateBoxOfCrayons(userId: number, earnedKeys: Set<string>, awards: AchievementAward[]): Promise<void> {
    if (earnedKeys.has('box_of_crayons')) return;
    const colors = await this.repo.countDistinctColors(userId);
    if (colors >= BOX_OF_CRAYONS_COLORS) {
      awards.push({ key: 'box_of_crayons', context: { colors } });
    }
  }
}
