export interface AchievementAward {
  key: string;
  context: Record<string, unknown> | null;
}

export interface EvaluationContext {
  userId: number;
  isSuperuser: boolean;
  eventName: string;
  payload: Record<string, unknown>;
}

export interface IAchievementEvaluator {
  supports(eventName: string): boolean;
  evaluate(ctx: EvaluationContext, earnedKeys: Set<string>): Promise<AchievementAward[]>;
}
