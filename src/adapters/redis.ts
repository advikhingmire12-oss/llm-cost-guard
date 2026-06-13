import type { RedisClientType } from "redis";
import { StorageAdapter } from "./memory";

/**
 * Redis-backed storage adapter for distributed spend tracking.
 *
 * Key naming (prefixed with `llmguard:`):
 * - Daily spend:    llmguard:daily:{YYYY-MM-DD}
 * - Monthly spend:  llmguard:monthly:{YYYY-MM}
 * - User daily:     llmguard:user:{userId}:daily:{YYYY-MM-DD}
 * - By model:       llmguard:model:{modelName}:{YYYY-MM-DD}
 *
 * Integration test: see tests/adapters.test.ts — requires Redis running locally
 */
export class RedisAdapter implements StorageAdapter {
  constructor(private redis: RedisClientType) {}

  private prefixKey(key: string): string {
    return `llmguard:${key}`;
  }

  async get(key: string): Promise<number> {
    const value = await this.redis.get(this.prefixKey(key));
    if (value === null) {
      return 0;
    }
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  async set(key: string, value: number, ttlSeconds?: number): Promise<void> {
    const redisKey = this.prefixKey(key);
    const serialized = String(value);

    if (ttlSeconds !== undefined) {
      await this.redis.set(redisKey, serialized, { EX: ttlSeconds });
    } else {
      await this.redis.set(redisKey, serialized);
    }
  }

  async increment(key: string, by: number): Promise<number> {
    const result = await this.redis.incrByFloat(this.prefixKey(key), by);
    const parsed = parseFloat(result);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}
