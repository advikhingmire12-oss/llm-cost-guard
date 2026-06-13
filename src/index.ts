import { guard as guardImpl, GuardConfig } from "./guard";
import { estimateCost } from "./estimator";
import { LimitExceededError, PreflightError } from "./errors";
import { UsageStats, SpendTracker } from "./tracker";
import { MemoryAdapter, StorageAdapter } from "./adapters/memory";

const globalAdapter = new MemoryAdapter();

export function getStats(storage?: StorageAdapter): Promise<UsageStats> {
  const adapter = storage ?? globalAdapter;
  return new SpendTracker(adapter).getStats();
}

export { guardImpl as guard, estimateCost, LimitExceededError, PreflightError };
export type { GuardConfig, UsageStats };
export { sendAlert } from "./alerts";
export type { AlertPayload } from "./alerts";
export { RedisAdapter } from "./adapters/redis";
export { MemoryAdapter, StorageAdapter, SpendTracker };
