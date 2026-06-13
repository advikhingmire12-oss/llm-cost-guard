import { calculateCost } from "./pricing";
import { StorageAdapter } from "./adapters/memory";
import { LimitExceededError } from "./errors";

export interface UsageStats {
  todayUSD: number;
  monthUSD: number;
  requestCount: number;
  byModel: Record<string, number>;
  byUser: Record<string, number>;
}

const DAILY_TTL_SECONDS = 86400 * 2;
const MONTHLY_TTL_SECONDS = 86400 * 35;

export class SpendTracker {
  constructor(private storage: StorageAdapter) {}

  private getDayKey(): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const day = String(now.getUTCDate()).padStart(2, "0");
    return `spend:day:${year}-${month}-${day}`;
  }

  private getMonthKey(): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    return `spend:month:${year}-${month}`;
  }

  private getUserDayKey(userId: string): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const day = String(now.getUTCDate()).padStart(2, "0");
    return `user:${userId}:daily:${year}-${month}-${day}`;
  }

  // Token counts are passed from API response.usage (extracted in guard.ts)
  async recordSpend(
    model: string,
    inputTokens: number,
    outputTokens: number,
    userId?: string,
    customPricing?: any,
    userDailyLimit?: number
  ): Promise<number> {
    const cost = calculateCost(
      model,
      inputTokens,
      outputTokens,
      customPricing
    );

    if (userId && userDailyLimit !== undefined) {
      const userDayKey = this.getUserDayKey(userId);
      const currentUserSpend = await this.storage.get(userDayKey);
      const projectedUserSpend = currentUserSpend + cost;
      if (projectedUserSpend > userDailyLimit) {
        throw new LimitExceededError(
          `User ${userId} daily limit of $${userDailyLimit.toFixed(2)} exceeded. Current spend: $${projectedUserSpend.toFixed(4)}`,
          "user",
          projectedUserSpend,
          userDailyLimit
        );
      }
    }

    const dayKey = this.getDayKey();
    const daySpend = await this.storage.increment(dayKey, cost);
    await this.storage.set(dayKey, daySpend, DAILY_TTL_SECONDS);

    const monthKey = this.getMonthKey();
    const monthSpend = await this.storage.increment(monthKey, cost);
    await this.storage.set(monthKey, monthSpend, MONTHLY_TTL_SECONDS);

    await this.storage.increment("spend:requests", 1);
    await this.storage.increment(`spend:model:${model}`, cost);

    if (userId) {
      await this.storage.increment(`spend:user:${userId}`, cost);

      const userDayKey = this.getUserDayKey(userId);
      const userSpend = await this.storage.increment(userDayKey, cost);
      await this.storage.set(userDayKey, userSpend, DAILY_TTL_SECONDS);
    }

    return cost;
  }

  async getUserDaySpend(userId: string): Promise<number> {
    return this.storage.get(this.getUserDayKey(userId));
  }

  async getDaySpend(): Promise<number> {
    return this.storage.get(this.getDayKey());
  }

  async getMonthSpend(): Promise<number> {
    return this.storage.get(this.getMonthKey());
  }

  async getStats(): Promise<UsageStats> {
    const [todayUSD, monthUSD, requestCount] = await Promise.all([
      this.getDaySpend(),
      this.getMonthSpend(),
      this.storage.get("spend:requests"),
    ]);

    return {
      todayUSD,
      monthUSD,
      requestCount,
      byModel: {},
      byUser: {},
    };
  }
}
