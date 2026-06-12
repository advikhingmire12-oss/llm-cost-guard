import { guard } from "../src/guard";
import { LimitExceededError } from "../src/errors";
import { calculateCost } from "../src/pricing";

describe("guard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("guard passes through normal response", async () => {
    const mockResponse = {
      id: "msg_123",
      content: [{ type: "text", text: "Hello" }],
      usage: {
        input_tokens: 100,
        output_tokens: 50,
      },
    };

    const mockClient = {
      messages: {
        create: jest.fn().mockResolvedValue(mockResponse),
      },
    };

    const guarded = guard(mockClient as any, { dailyLimit: 10 });
    const result = await guarded.messages.create({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(mockClient.messages.create).toHaveBeenCalledWith({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(result).toEqual(mockResponse);
  });

  test("guard throws LimitExceededError when daily limit exceeded", async () => {
    const mockResponse = {
      id: "msg_123",
      usage: {
        input_tokens: 100000,
        output_tokens: 50000,
      },
    };

    const mockClient = {
      messages: {
        create: jest.fn().mockResolvedValue(mockResponse),
      },
    };

    const guarded = guard(mockClient as any, {
      dailyLimit: 0.01,
      onLimit: "throw",
    });

    await expect(
      guarded.messages.create({
        model: "claude-opus-4-6",
        messages: [{ role: "user", content: "Hello" }],
      })
    ).rejects.toThrow(LimitExceededError);
  });

  test("guard warns but does not throw when onLimit is warn", async () => {
    const consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();

    const mockResponse = {
      id: "msg_123",
      usage: {
        input_tokens: 100000,
        output_tokens: 50000,
      },
    };

    const mockClient = {
      messages: {
        create: jest.fn().mockResolvedValue(mockResponse),
      },
    };

    const guarded = guard(mockClient as any, {
      dailyLimit: 0.01,
      onLimit: "warn",
    });

    const result = await guarded.messages.create({
      model: "claude-opus-4-6",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(result).toEqual(mockResponse);
    expect(consoleWarnSpy).toHaveBeenCalled();
    expect(consoleWarnSpy.mock.calls[0][0]).toContain("Daily limit exceeded");

    consoleWarnSpy.mockRestore();
  });

  test("calculateCost returns correct value", () => {
    const cost = calculateCost("claude-sonnet-4-6", 1000, 500);
    // claude-sonnet-4-6: input $3/million, output $15/million
    // input cost: (1000/1_000_000) * 3 = 0.003
    // output cost: (500/1_000_000) * 15 = 0.0075
    // total: 0.0105
    expect(cost).toBeCloseTo(0.0105, 4);
  });
});
