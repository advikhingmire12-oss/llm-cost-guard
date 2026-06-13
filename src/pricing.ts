export const PRICING: Record<
  string,
  { inputPerMillion: number; outputPerMillion: number }
> = {
  "claude-opus-4-6": { inputPerMillion: 15.0, outputPerMillion: 75.0 },
  "claude-sonnet-4-6": { inputPerMillion: 3.0, outputPerMillion: 15.0 },
  "claude-haiku-4-5": { inputPerMillion: 0.8, outputPerMillion: 4.0 },
  "gpt-4o": { inputPerMillion: 5.0, outputPerMillion: 15.0 },
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "gpt-3.5-turbo": { inputPerMillion: 0.5, outputPerMillion: 1.5 },
  "gemini-1.5-pro": { inputPerMillion: 3.5, outputPerMillion: 10.5 },
  "gemini-1.5-flash": { inputPerMillion: 0.075, outputPerMillion: 0.3 },
  "gemini-2.0-flash": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
};

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  customPricing?: Record<
    string,
    { inputPerMillion: number; outputPerMillion: number }
  >
): number {
  const pricing =
    customPricing?.[model] ?? PRICING[model];

  if (!pricing) {
    throw new Error("Unknown model: " + model);
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;

  return inputCost + outputCost;
}
