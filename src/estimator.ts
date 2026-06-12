import { calculateCost } from "./pricing";

export interface EstimateInput {
  provider: "anthropic" | "openai" | "google";
  model: string;
  messages: Array<{ role: string; content: string }>;
  customPricing?: Record<
    string,
    { inputPerMillion: number; outputPerMillion: number }
  >;
}

export interface EstimateResult {
  estimatedInputTokens: number;
  estimatedCostUSD: number;
  willBreachLimit: boolean;
}

export async function estimateCost(
  input: EstimateInput,
  dailySpentSoFar?: number,
  dailyLimit?: number
): Promise<EstimateResult> {
  const totalChars = input.messages.reduce(
    (sum, msg) => sum + msg.content.length,
    0
  );

  const estimatedInputTokens = Math.ceil(totalChars / 4);
  const estimatedOutputTokens = Math.ceil(estimatedInputTokens * 0.25);

  const estimatedCostUSD = calculateCost(
    input.model,
    estimatedInputTokens,
    estimatedOutputTokens,
    input.customPricing
  );

  let willBreachLimit = false;
  if (
    dailySpentSoFar !== undefined &&
    dailyLimit !== undefined &&
    dailySpentSoFar + estimatedCostUSD > dailyLimit
  ) {
    willBreachLimit = true;
  }

  return {
    estimatedInputTokens,
    estimatedCostUSD,
    willBreachLimit,
  };
}
