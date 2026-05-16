import { Injectable } from '@nestjs/common';

import type { AchievementAward, EvaluationContext, IAchievementEvaluator } from './evaluator.interface';

@Injectable()
export class EvaluatorRegistry {
  private readonly evaluators: IAchievementEvaluator[] = [];

  register(evaluator: IAchievementEvaluator): void {
    this.evaluators.push(evaluator);
  }

  async evaluate(ctx: EvaluationContext, earnedKeys: Set<string>): Promise<AchievementAward[]> {
    const relevant = this.evaluators.filter((e) => e.supports(ctx.eventName));
    const results = await Promise.all(relevant.map((e) => e.evaluate(ctx, earnedKeys)));
    return results.flat();
  }
}
