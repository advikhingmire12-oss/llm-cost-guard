# @advik1228/llm-cost-guard

[![npm version](https://img.shields.io/npm/v/%40advik1228%2Fllm-cost-guard)](https://www.npmjs.com/package/@advik1228/llm-cost-guard)
[![npm downloads](https://img.shields.io/npm/dm/%40advik1228%2Fllm-cost-guard)](https://www.npmjs.com/package/@advik1228/llm-cost-guard)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Drop-in cost guard for LLM API clients. Wrap your Anthropic, OpenAI, or Google Gemini client with a JavaScript Proxy — track spend, enforce limits, and get alerts without changing your application code.

## Why This Exists

LLM API costs can spike silently. A single runaway loop or oversized prompt can burn through a daily budget in minutes. Most teams discover overspend only after the invoice arrives.

**@advik1228/llm-cost-guard** sits between your app and the LLM provider. It reads real token counts from API responses, calculates cost in USD, enforces configurable limits, and optionally fires webhook alerts — all with one wrapper call.

## Features

- **Zero code changes** — wrap existing clients via Proxy; intercepts `messages.create`, `chat.completions.create`, and Gemini `generateContent`
- **Real token counts** — reads `usage` from API responses (not tiktoken estimates at runtime)
- **Daily, monthly, and per-request limits** — throw, warn, or silently ignore on breach
- **Per-user budget tracking** — isolate spend by `userId` with optional `userDailyLimit`
- **Pre-flight estimation** — estimate cost before sending (char/4 heuristic)
- **Streaming support** — Anthropic and OpenAI streaming with usage captured after stream completes
- **Webhook alerts** — Slack/Discord/custom webhook on warn threshold or limit breach
- **Pluggable storage** — in-memory (default) or Redis for multi-instance deployments
- **Custom pricing** — override built-in model rates for private or fine-tuned models
- **TypeScript-first** — full type definitions included

## Installation

```bash
npm install @advik1228/llm-cost-guard
```

## Quick Start

### Anthropic

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { guard } from "@advik1228/llm-cost-guard";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const guarded = guard(client, {
  dailyLimit: 5.0,
  warnAt: 4.0,
  onLimit: "throw",
});

const response = await guarded.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello!" }],
});

console.log(response.content);
```

### OpenAI

```typescript
import OpenAI from "openai";
import { guard } from "@advik1228/llm-cost-guard";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const guarded = guard(client, {
  dailyLimit: 10.0,
  monthlyLimit: 100.0,
  perRequestLimit: 0.50,
  onLimit: "throw",
});

const response = await guarded.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello!" }],
});

console.log(response.choices[0].message.content);
```

## Configuration

Pass a `GuardConfig` object as the second argument to `guard()`:

| Option | Type | Description |
|--------|------|-------------|
| `dailyLimit` | `number` | Max USD spend per UTC day |
| `monthlyLimit` | `number` | Max USD spend per UTC month |
| `perRequestLimit` | `number` | Max USD per single API call |
| `warnAt` | `number` | USD threshold to trigger a warning (and webhook if configured) |
| `onLimit` | `"throw" \| "warn" \| "silent"` | Behavior when a limit is exceeded (default: `"throw"`) |
| `userId` | `string` | Track spend for a specific user |
| `userDailyLimit` | `number` | Per-user daily USD cap |
| `alertWebhook` | `string` | URL to POST alert payloads on warn/limit events |
| `preflight` | `boolean` | Reserved for pre-flight enforcement |
| `storage` | `"memory" \| StorageAdapter` | Storage backend (default: in-memory) |
| `customPricing` | `Record<string, { inputPerMillion, outputPerMillion }>` | Override built-in model pricing |

```typescript
const guarded = guard(client, {
  dailyLimit: 5.0,
  monthlyLimit: 50.0,
  perRequestLimit: 1.0,
  warnAt: 4.0,
  onLimit: "throw",
  alertWebhook: "https://hooks.slack.com/services/...",
  userId: "user_abc123",
  userDailyLimit: 0.50,
});
```

## Per-User Budget Tracking

Track spend per end-user in multi-tenant apps:

```typescript
const guarded = guard(client, {
  dailyLimit: 100.0,       // org-wide cap
  userId: req.user.id,
  userDailyLimit: 2.0,     // per-user cap
  onLimit: "throw",
});
```

When a user's daily spend exceeds `userDailyLimit`, a `LimitExceededError` is thrown with `limitType: "user"`.

## Pre-Flight Cost Estimation

Estimate cost before making a call (uses char/4 token heuristic, assumes output = 25% of input):

```typescript
import { estimateCost } from "@advik1228/llm-cost-guard";

const estimate = await estimateCost(
  {
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    messages: [{ role: "user", content: "Summarize this 10-page document..." }],
  },
  2.5,  // dailySpentSoFar (USD)
  5.0   // dailyLimit (USD)
);

console.log(estimate.estimatedCostUSD);   // e.g. 0.003
console.log(estimate.willBreachLimit);    // false
```

Streaming requests run a pre-flight check via `estimateCost()` before the stream starts.

## Webhook Alerts

Set `alertWebhook` to receive JSON POST payloads on warn threshold or limit breach:

```typescript
const guarded = guard(client, {
  dailyLimit: 10.0,
  warnAt: 8.0,
  alertWebhook: "https://your-webhook.example.com/alerts",
});
```

**Payload shape:**

```json
{
  "event": "warn_threshold_reached",
  "currentSpendUSD": 8.12,
  "limitUSD": 10.0,
  "warnAtUSD": 8.0,
  "timestamp": "2026-06-13T12:00:00.000Z",
  "provider": "anthropic",
  "userId": "user_abc123"
}
```

Events: `warn_threshold_reached`, `limit_reached`, `per_request_limit_reached`, `user_limit_reached`.

Alerts are fire-and-forget — webhook failures are logged but never throw.

## Usage Stats

```typescript
import { getStats } from "@advik1228/llm-cost-guard";

const stats = await getStats();
console.log(stats.todayUSD);      // today's spend
console.log(stats.monthUSD);      // this month's spend
console.log(stats.requestCount);  // total requests tracked
console.log(stats.byModel);       // spend by model (future)
console.log(stats.byUser);        // spend by user (future)
```

> **Note:** `getStats()` uses a module-level in-memory tracker. For production, pass a shared `StorageAdapter` via `guard({ storage })` and query it directly.

## Error Reference

### `LimitExceededError`

Thrown when a configured limit is exceeded (when `onLimit: "throw"`).

```typescript
import { LimitExceededError } from "@advik1228/llm-cost-guard";

try {
  await guarded.messages.create({ ... });
} catch (err) {
  if (err instanceof LimitExceededError) {
    console.log(err.limitType);     // "daily" | "monthly" | "perRequest" | "user"
    console.log(err.currentSpend);  // current USD spend
    console.log(err.limit);         // configured limit
  }
}
```

### `PreflightError`

Reserved for pre-flight enforcement when estimated cost exceeds remaining budget.

```typescript
import { PreflightError } from "@advik1228/llm-cost-guard";
// err.estimatedCost, err.remainingBudget
```

## Supported Models & Pricing

Prices in USD per 1 million tokens (input / output):

| Model | Input | Output |
|-------|------:|-------:|
| `claude-opus-4-6` | $15.00 | $75.00 |
| `claude-sonnet-4-6` | $3.00 | $15.00 |
| `claude-haiku-4-5` | $0.80 | $4.00 |
| `gpt-4o` | $5.00 | $15.00 |
| `gpt-4o-mini` | $0.15 | $0.60 |
| `gpt-3.5-turbo` | $0.50 | $1.50 |
| `gemini-1.5-pro` | $3.50 | $10.50 |
| `gemini-1.5-flash` | $0.075 | $0.30 |
| `gemini-2.0-flash` | $0.10 | $0.40 |

## Custom Pricing Override

Override or add models not in the built-in table:

```typescript
const guarded = guard(client, {
  dailyLimit: 10.0,
  customPricing: {
    "my-fine-tuned-model": {
      inputPerMillion: 1.0,
      outputPerMillion: 3.0,
    },
  },
});
```

## Redis Storage

For multi-instance deployments, use Redis instead of in-memory storage:

```typescript
import { createClient } from "redis";
import { guard, RedisAdapter } from "@advik1228/llm-cost-guard";

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const guarded = guard(client, {
  dailyLimit: 10.0,
  storage: new RedisAdapter(redis),
});
```

Or import the adapter directly:

```typescript
import { RedisAdapter } from "@advik1228/llm-cost-guard/adapters";
```

All Redis keys are prefixed with `llmguard:` to avoid collisions.

## Custom Storage Adapter

Implement the `StorageAdapter` interface for your own backend:

```typescript
import { guard, StorageAdapter } from "@advik1228/llm-cost-guard";

class PostgresAdapter implements StorageAdapter {
  async get(key: string): Promise<number> { /* ... */ return 0; }
  async set(key: string, value: number, ttlSeconds?: number): Promise<void> { /* ... */ }
  async increment(key: string, by: number): Promise<number> { /* ... */ return 0; }
}

const guarded = guard(client, {
  dailyLimit: 10.0,
  storage: new PostgresAdapter(),
});
```

## Environment Variables

The library does not read environment variables directly. Pass credentials and config from your app:

```bash
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
REDIS_URL=redis://localhost:6379
```

```typescript
const guarded = guard(client, {
  dailyLimit: parseFloat(process.env.DAILY_LLM_BUDGET ?? "5"),
  alertWebhook: process.env.LLM_ALERT_WEBHOOK,
});
```

## TypeScript Support

Full type definitions are included. Import types as needed:

```typescript
import {
  guard,
  GuardConfig,
  UsageStats,
  LimitExceededError,
  PreflightError,
  AlertPayload,
} from "@advik1228/llm-cost-guard";
```

## Contributing

### Setup

```bash
git clone https://github.com/advikhingmire12-oss/llm-cost-guard.git
cd llm-cost-guard
npm install
npm run build
npm test
```

### Project Structure

```
src/
  index.ts          # Public exports
  guard.ts          # Proxy wrapper + limit enforcement
  tracker.ts        # SpendTracker — records and queries spend
  pricing.ts        # Model pricing table + calculateCost()
  estimator.ts      # Pre-flight cost estimation
  errors.ts         # LimitExceededError, PreflightError
  alerts.ts         # Webhook alert sender
  adapters/
    memory.ts       # In-memory StorageAdapter (default)
    redis.ts        # Redis StorageAdapter
tests/
  guard.test.ts
  estimator.test.ts
```

### How to Add a Provider

1. In `src/guard.ts`, detect the provider's API call pattern in the Proxy `get` trap (method name + parent object path).
2. Add token extraction in `extractTokens()` using the provider's `usage` response shape.
3. For nested clients (like Gemini's `getGenerativeModel`), wrap returned objects in a secondary Proxy.
4. Add model pricing to `PRICING` in `src/pricing.ts`.
5. Add tests in `tests/guard.test.ts` with a mocked client.

### PR Rules

- All tests must pass (`npm test`) before submitting
- Keep changes focused — one feature or fix per PR
- Add tests for new behavior
- Do not change public API without discussion
- Follow existing TypeScript style (strict mode, no `any` unless unavoidable)

## Roadmap

- [ ] Full `byModel` and `byUser` breakdown in `getStats()`
- [ ] Preflight enforcement via `preflight: true` config flag
- [ ] Dashboard / CLI for live spend monitoring
- [ ] AWS Bedrock and Azure OpenAI adapters
- [ ] Rate limiting (requests per minute, not just cost)

## License

MIT — see [LICENSE](LICENSE).

## Author

**Advik** — [github.com/advikhingmire12-oss](https://github.com/advikhingmire12-oss)
