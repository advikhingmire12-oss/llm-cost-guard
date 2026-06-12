export class LimitExceededError extends Error {
  constructor(
    message: string,
    public limitType: "daily" | "monthly" | "perRequest" | "user",
    public currentSpend: number,
    public limit: number
  ) {
    super(message);
    this.name = "LimitExceededError";
  }
}

export class PreflightError extends Error {
  constructor(
    message: string,
    public estimatedCost: number,
    public remainingBudget: number
  ) {
    super(message);
    this.name = "PreflightError";
  }
}
