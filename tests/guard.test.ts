import { guard } from "../src/guard";
import { LimitExceededError } from "../src/errors";
import { calculateCost } from "../src/pricing";
import { sendAlert, AlertPayload } from "../src/alerts";
import { MemoryAdapter } from "../src/adapters/memory";

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

  test("sends webhook alert when warnAt threshold crossed", async () => {
    const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
    } as Response);

    const mockResponse = {
      id: "msg_123",
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

    const guarded = guard(mockClient as any, {
      warnAt: 0.000001,
      alertWebhook: "https://fake.webhook/test",
    });

    await guarded.messages.create({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://fake.webhook/test",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.any(String),
      })
    );

    const callBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string);
    expect(callBody.event).toBe("warn_threshold_reached");
    expect(callBody.currentSpendUSD).toBeGreaterThan(0);
    expect(callBody.warnAtUSD).toBe(0.000001);
    expect(typeof callBody.timestamp).toBe("string");

    fetchSpy.mockRestore();
  });

  test("throws LimitExceededError with limitType user when user daily limit exceeded", async () => {
    const mockResponse = {
      id: "msg_123",
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

    const guarded = guard(mockClient as any, {
      userId: "user_test",
      userDailyLimit: 0.000001,
      dailyLimit: 100,
      onLimit: "throw",
    });

    let error: LimitExceededError | undefined;
    try {
      await guarded.messages.create({
        model: "claude-sonnet-4-6",
        messages: [{ role: "user", content: "Hello" }],
      });
    } catch (err) {
      error = err as LimitExceededError;
    }

    expect(error).toBeInstanceOf(LimitExceededError);
    expect(error!.limitType).toBe("user");
    expect(error!.limit).toBe(0.000001);
    expect(error!.currentSpend).toBeGreaterThan(0);
  });

  test("guard tracks cost for Gemini generateContent response", async () => {
    const mockGeminiResponse = {
      response: {
        usageMetadata: {
          promptTokenCount: 200,
          candidatesTokenCount: 100,
        },
      },
    };

    const mockModel = {
      generateContent: jest.fn().mockResolvedValue(mockGeminiResponse),
    };

    const mockGeminiClient = {
      getGenerativeModel: jest.fn().mockReturnValue(mockModel),
    };

    const guarded = guard(mockGeminiClient as any, { dailyLimit: 10 });
    const model = guarded.getGenerativeModel({ model: "gemini-1.5-pro" });
    const result = await model.generateContent("Hello Gemini");

    expect(mockGeminiClient.getGenerativeModel).toHaveBeenCalledWith({
      model: "gemini-1.5-pro",
    });
    expect(mockModel.generateContent).toHaveBeenCalledWith("Hello Gemini");
    expect(result).toEqual(mockGeminiResponse);
  });

  test("records spend after streaming Anthropic response completes", async () => {
    async function* mockStream() {
      yield {
        type: "message_start",
        message: { usage: { input_tokens: 100, output_tokens: 0 } },
      };
      yield { type: "content_block_delta", delta: { type: "text_delta", text: "Hi" } };
      yield { type: "message_delta", usage: { output_tokens: 50 } };
    }

    const mockClient = {
      messages: {
        create: jest.fn().mockResolvedValue(mockStream()),
      },
    };

    const storage = new MemoryAdapter();
    const guarded = guard(mockClient as any, { storage, dailyLimit: 10 });

    const stream = await guarded.messages.create({
      model: "claude-sonnet-4-6",
      stream: true,
      messages: [{ role: "user", content: "Hello" }],
    });

    const chunks: unknown[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);

    const now = new Date();
    const dayKey = `spend:day:${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
    const daySpend = await storage.get(dayKey);
    expect(daySpend).toBeCloseTo(0.00105, 5);
  });
});
