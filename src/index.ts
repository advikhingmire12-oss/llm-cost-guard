import { guard as guardImpl, GuardConfig } from "./guard";
import { estimateCost } from "./estimator";
import { LimitExceededError, PreflightError } from "./errors";
import { UsageStats, SpendTracker } from "./tracker";
import { MemoryAdapter } from "./adapters/memory";

const globalAdapter = new MemoryAdapter();
const globalTracker = new SpendTracker(globalAdapter);

export function getStats(): Promise<UsageStats> {
  return globalTracker.getStats();
}

export { guardImpl as guard, estimateCost, LimitExceededError, PreflightError };
export type { GuardConfig, UsageStats };
