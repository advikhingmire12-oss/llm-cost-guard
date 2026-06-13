import { SpendTracker } from "./tracker";
import { MemoryAdapter, StorageAdapter } from "./adapters/memory";
import { LimitExceededError } from "./errors";
import { sendAlert, AlertPayload } from "./alerts";
import { estimateCost } from "./estimator";

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

function isGeminiClient(obj: any): boolean {
  return typeof obj?.getGenerativeModel === "function";
}

function createGeminiModelProxy(
  model: any,
  modelName: string,
  tracker: SpendTracker,
  config: GuardConfig,
  state: GuardState
): any {
  return new Proxy(model, {
    get(modelObj, prop) {
      const value = (modelObj as Record<string | symbol, unknown>)[prop];

      if (typeof value === "function" && prop === "generateContent") {
        return async (...args: unknown[]) => {
          const result = await (value as (...args: unknown[]) => unknown).apply(
            modelObj,
            args
          );

          // Extract tokens from Gemini response
          const { input: inputTokens, output: outputTokens } = extractTokens(
            result,
            "google"
          );

          const requestCost = await tracker.recordSpend(
            modelName,
            inputTokens,
            outputTokens,
            config.userId,
            config.customPricing,
            config.userDailyLimit
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
            if (config.alertWebhook) {
              const payload: AlertPayload = {
                event: "limit_reached",
                currentSpendUSD: daySpend,
                limitUSD: config.dailyLimit,
                timestamp: new Date().toISOString(),
                provider: "google",
                userId: config.userId,
              };
              sendAlert(config.alertWebhook, payload);
            }

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

            if (config.alertWebhook && !state.warningSentToday) {
              const payload: AlertPayload = {
                event: "warn_threshold_reached",
                currentSpendUSD: daySpend,
                limitUSD: config.dailyLimit ?? 0,
                warnAtUSD: config.warnAt,
                timestamp: new Date().toISOString(),
                provider: "google",
                userId: config.userId,
              };
              sendAlert(config.alertWebhook, payload);
              state.warningSentToday = true;
            }
          }

          return result;
        };
      }

      return value;
    },
  });
}

function getCurrentUTCDate(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function extractTokens(
  response: any,
  provider: "anthropic" | "openai" | "google"
): { input: number; output: number } {
  if (provider === "anthropic") {
    return {
      input: response?.usage?.input_tokens ?? 0,
      output: response?.usage?.output_tokens ?? 0,
    };
  }
  if (provider === "openai") {
    return {
      input: response?.usage?.prompt_tokens ?? 0,
      output: response?.usage?.completion_tokens ?? 0,
    };
  }
  if (provider === "google") {
    // Gemini SDK: result.response.usageMetadata
    const usage = response?.response?.usageMetadata;
    return {
      input: usage?.promptTokenCount ?? 0,
      output: usage?.candidatesTokenCount ?? 0,
    };
  }
  return { input: 0, output: 0 };
}

type TrackedProvider = "anthropic" | "openai" | "google";

function normalizeMessages(
  messages: Array<{ role?: string; content?: unknown }> | undefined
): Array<{ role: string; content: string }> {
  return (messages ?? []).map((message) => ({
    role: message.role ?? "user",
    content:
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content ?? ""),
  }));
}

async function runStreamingPreflightCheck(
  arg0: { model?: string; messages?: Array<{ role?: string; content?: unknown }> },
  provider: "anthropic" | "openai",
  tracker: SpendTracker,
  config: GuardConfig
): Promise<void> {
  const daySpend = await tracker.getDaySpend();
  const estimate = await estimateCost(
    {
      provider,
      model: arg0.model ?? "unknown",
      messages: normalizeMessages(arg0.messages),
      customPricing: config.customPricing,
    },
    daySpend,
    config.dailyLimit
  );

  if (config.perRequestLimit && estimate.estimatedCostUSD > config.perRequestLimit) {
    const action = config.onLimit ?? "throw";
    if (action === "throw") {
      throw new LimitExceededError(
        `Per-request limit exceeded (estimated): $${estimate.estimatedCostUSD.toFixed(4)} > $${config.perRequestLimit}`,
        "perRequest",
        estimate.estimatedCostUSD,
        config.perRequestLimit
      );
    } else if (action === "warn") {
      console.warn(
        `[llm-cost-guard] Per-request limit exceeded (estimated): $${estimate.estimatedCostUSD.toFixed(4)} > $${config.perRequestLimit}`
      );
    }
  }

  if (estimate.willBreachLimit) {
    const action = config.onLimit ?? "throw";
    if (action === "throw") {
      throw new LimitExceededError(
        `Daily limit would be exceeded (estimated): $${(daySpend + estimate.estimatedCostUSD).toFixed(4)} > $${config.dailyLimit}`,
        "daily",
        daySpend + estimate.estimatedCostUSD,
        config.dailyLimit!
      );
    } else if (action === "warn") {
      console.warn(
        `[llm-cost-guard] Daily limit would be exceeded (estimated): $${(daySpend + estimate.estimatedCostUSD).toFixed(4)} > $${config.dailyLimit}`
      );
    }
  }
}

function captureStreamTokens(
  chunk: any,
  provider: TrackedProvider,
  tokens: { input: number; output: number }
): void {
  if (provider === "anthropic") {
    if (chunk?.type === "message_start") {
      tokens.input =
        chunk.message?.usage?.input_tokens ?? tokens.input;
    }
    if (chunk?.type === "message_delta") {
      tokens.output = chunk.usage?.output_tokens ?? tokens.output;
    }
    return;
  }

  if (provider === "openai" && chunk?.usage) {
    tokens.input = chunk.usage.prompt_tokens ?? tokens.input;
    tokens.output = chunk.usage.completion_tokens ?? tokens.output;
  }
}

async function applyLimitsAfterSpend(
  requestCost: number,
  provider: TrackedProvider,
  tracker: SpendTracker,
  config: GuardConfig,
  state: GuardState
): Promise<void> {
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
    if (config.alertWebhook) {
      const payload: AlertPayload = {
        event: "limit_reached",
        currentSpendUSD: daySpend,
        limitUSD: config.dailyLimit,
        timestamp: new Date().toISOString(),
        provider,
        userId: config.userId,
      };
      sendAlert(config.alertWebhook, payload);
    }

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

    if (config.alertWebhook && !state.warningSentToday) {
      const payload: AlertPayload = {
        event: "warn_threshold_reached",
        currentSpendUSD: daySpend,
        limitUSD: config.dailyLimit ?? 0,
        warnAtUSD: config.warnAt,
        timestamp: new Date().toISOString(),
        provider,
        userId: config.userId,
      };
      sendAlert(config.alertWebhook, payload);
      state.warningSentToday = true;
    }
  }
}

async function* wrapStreamingIterable(
  stream: AsyncIterable<any>,
  provider: TrackedProvider,
  model: string,
  tracker: SpendTracker,
  config: GuardConfig,
  state: GuardState
): AsyncGenerator<any> {
  const tokens = { input: 0, output: 0 };

  for await (const chunk of stream) {
    captureStreamTokens(chunk, provider, tokens);
    yield chunk;
  }

  const requestCost = await tracker.recordSpend(
    model,
    tokens.input,
    tokens.output,
    config.userId,
    config.customPricing,
    config.userDailyLimit
  );

  await applyLimitsAfterSpend(requestCost, provider, tracker, config, state);
}

interface GuardState {
  warningSentToday: boolean;
  lastCheckedDate: string;
}

function createProxy<T extends object>(
  target: T,
  tracker: SpendTracker,
  config: GuardConfig,
  state: GuardState,
  parentProp?: string | symbol
): T {
  return new Proxy(target, {
    get(obj, prop) {
      const value = (obj as Record<string | symbol, unknown>)[prop];

      // Check if date changed and reset warning flag at midnight UTC
      const currentDate = getCurrentUTCDate();
      if (state.lastCheckedDate !== currentDate) {
        state.lastCheckedDate = currentDate;
        state.warningSentToday = false;
      }

      // Gemini: intercept getGenerativeModel synchronously so the returned model
      // is the proxy, not a Promise wrapping the proxy.
      if (prop === "getGenerativeModel" && isGeminiClient(obj) && typeof value === "function") {
        return (...args: unknown[]) => {
          const modelConfig = args[0] as { model?: string } | undefined;
          const modelName = modelConfig?.model ?? "unknown";
          const realModel = (value as (...a: unknown[]) => unknown).apply(obj, args);
          return createGeminiModelProxy(realModel, modelName, tracker, config, state);
        };
      }

      if (typeof value === "function") {
        return async (...args: unknown[]) => {
          const isTrackedCall =
            isAnthropicMessagesCreate(prop, parentProp) ||
            isOpenAIChatCompletionsCreate(prop, parentProp);

          if (isTrackedCall) {
            const arg0 = args[0] as
              | {
                  model?: string;
                  messages?: Array<{ role?: string; content?: unknown }>;
                  stream?: boolean;
                  stream_options?: { include_usage?: boolean };
                }
              | undefined;
            const model = arg0?.model ?? "unknown";

            let provider: TrackedProvider = "google";
            if (isAnthropicMessagesCreate(prop, parentProp)) {
              provider = "anthropic";
            } else if (isOpenAIChatCompletionsCreate(prop, parentProp)) {
              provider = "openai";
            }

            if (arg0?.stream === true) {
              await runStreamingPreflightCheck(
                arg0,
                provider as "anthropic" | "openai",
                tracker,
                config
              );

              let callArgs = args;
              if (provider === "openai" && arg0) {
                callArgs = [
                  {
                    ...arg0,
                    stream_options: {
                      include_usage: true,
                      ...arg0.stream_options,
                    },
                  },
                  ...args.slice(1),
                ];
              }

              const stream = await (value as (...args: unknown[]) => unknown).apply(
                obj,
                callArgs
              );

              return wrapStreamingIterable(
                stream as AsyncIterable<any>,
                provider,
                model,
                tracker,
                config,
                state
              );
            }

            const result = await (value as (...args: unknown[]) => unknown).apply(
              obj,
              args
            );

            const { input: inputTokens, output: outputTokens } = extractTokens(
              result,
              provider
            );

            const requestCost = await tracker.recordSpend(
              model,
              inputTokens,
              outputTokens,
              config.userId,
              config.customPricing,
              config.userDailyLimit
            );

            await applyLimitsAfterSpend(
              requestCost,
              provider,
              tracker,
              config,
              state
            );

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
          state,
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

  const state: GuardState = {
    warningSentToday: false,
    lastCheckedDate: getCurrentUTCDate(),
  };

  return createProxy(client, tracker, config, state);
}
