import { SpendTracker } from "./tracker";
import { MemoryAdapter, StorageAdapter } from "./adapters/memory";
import { LimitExceededError } from "./errors";
import { calculateCost } from "./pricing";

export interface GuardConfig {
  dailyLimit?: number;
  monthlyLimit?: number;
  perRequestLimit?: number;
  warnAt?: number;
  onLimit?: "throw" | "warn" | "silent";
  userId?: string;
  userDailyLimit?: number;
  alertWebhook?: string;
  preflight?: boolean;
  storage?: "memory" | StorageAdapter;
  customPricing?: Record<
    string,
    { inputPerMillion: number; outputPerMillion: number }
  >;
}

function isAnthropicMessagesCreate(
  prop: string | symbol,
  parentProp?: string | symbol
): boolean {
  return parentProp === "messages" && prop === "create";
}

function isOpenAIChatCompletionsCreate(
  prop: string | symbol,
  parentProp?: string | symbol
): boolean {
  return parentProp === "completions" && prop === "create";
}

function createProxy<T extends object>(
  target: T,
  tracker: SpendTracker,
  config: GuardConfig,
  parentProp?: string | symbol
): T {
  return new Proxy(target, {
    get(obj, prop) {
      const value = (obj as Record<string | symbol, unknown>)[prop];

      if (typeof value === "function") {
        return async (...args: unknown[]) => {
          const isTrackedCall =
            isAnthropicMessagesCreate(prop, parentProp) ||
            isOpenAIChatCompletionsCreate(prop, parentProp);

          if (isTrackedCall) {
            const arg0 = args[0] as
              | { model?: string; messages?: unknown[] }
              | undefined;
            const model = arg0?.model ?? "unknown";

            const result = await (value as (...args: unknown[]) => unknown).apply(
              obj,
              args
            );

            let inputTokens = 0;
            let outputTokens = 0;

            if (
              result &&
              typeof result === "object" &&
              "usage" in result &&
              result.usage &&
              typeof result.usage === "object"
            ) {
              const usage = result.usage as {
                input_tokens?: number;
                output_tokens?: number;
                prompt_tokens?: number;
                completion_tokens?: number;
              };

              if (isAnthropicMessagesCreate(prop, parentProp)) {
                inputTokens = usage.input_tokens ?? 0;
                outputTokens = usage.output_tokens ?? 0;
              } else if (
                isOpenAIChatCompletionsCreate(prop, parentProp)
              ) {
                inputTokens = usage.prompt_tokens ?? 0;
                outputTokens = usage.completion_tokens ?? 0;
              }
            }

            const requestCost = await tracker.recordSpend(
              model,
              inputTokens,
              outputTokens,
              config.userId,
              config.customPricing
            );

            const daySpend = await tracker.getDaySpend();
            const monthSpend = await tracker.getMonthSpend();

            if (config.perRequestLimit && requestCost > config.perRequestLimit) {
              const action = config.onLimit ?? "throw";
              if (action === "throw") {
                throw new LimitExceededError(
                  `Per-request limit exceeded: $${requestCost.toFixed(4)} > $${config.perRequestLimit}`,
                  "perRequest",
                  requestCost,
                  config.perRequestLimit
                );
              } else if (action === "warn") {
                console.warn(
                  `[llm-cost-guard] Per-request limit exceeded: $${requestCost.toFixed(4)} > $${config.perRequestLimit}`
                );
              }
            }

            if (config.dailyLimit && daySpend > config.dailyLimit) {
              const action = config.onLimit ?? "throw";
              if (action === "throw") {
                throw new LimitExceededError(
                  `Daily limit exceeded: $${daySpend.toFixed(4)} > $${config.dailyLimit}`,
                  "daily",
                  daySpend,
                  config.dailyLimit
                );
              } else if (action === "warn") {
                console.warn(
                  `[llm-cost-guard] Daily limit exceeded: $${daySpend.toFixed(4)} > $${config.dailyLimit}`
                );
              }
            }

            if (config.monthlyLimit && monthSpend > config.monthlyLimit) {
              const action = config.onLimit ?? "throw";
              if (action === "throw") {
                throw new LimitExceededError(
                  `Monthly limit exceeded: $${monthSpend.toFixed(4)} > $${config.monthlyLimit}`,
                  "monthly",
                  monthSpend,
                  config.monthlyLimit
                );
              } else if (action === "warn") {
                console.warn(
                  `[llm-cost-guard] Monthly limit exceeded: $${monthSpend.toFixed(4)} > $${config.monthlyLimit}`
                );
              }
            }

            if (config.warnAt && daySpend >= config.warnAt) {
              console.warn(
                `[llm-cost-guard] Daily spend warning: $${daySpend.toFixed(4)} >= $${config.warnAt} (limit: $${config.dailyLimit ?? "unlimited"})`
              );
            }

            return result;
          }

          return (value as (...args: unknown[]) => unknown).apply(obj, args);
        };
      }

      if (value && typeof value === "object") {
        return createProxy(
          value as object,
          tracker,
          config,
          prop
        ) as unknown;
      }

      return value;
    },
  }) as T;
}

export function guard<T extends object>(client: T, config: GuardConfig): T {
  const storage: StorageAdapter =
    config.storage === undefined || config.storage === "memory"
      ? new MemoryAdapter()
      : config.storage;

  const tracker = new SpendTracker(storage);

  return createProxy(client, tracker, config);
}
