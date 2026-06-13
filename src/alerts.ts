export interface AlertPayload {
  event:
    | "warn_threshold_reached"
    | "limit_reached"
    | "per_request_limit_reached"
    | "user_limit_reached";
  currentSpendUSD: number;
  limitUSD: number;
  warnAtUSD?: number;
  timestamp: string;
  provider: string;
  userId?: string;
}

export async function sendAlert(
  webhookUrl: string,
  payload: AlertPayload
): Promise<void> {
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.warn(
        `[llm-cost-guard] Webhook returned ${response.status}: ${response.statusText}`
      );
    }
  } catch (error) {
    console.warn(
      `[llm-cost-guard] Failed to send alert to webhook: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
