import { estimateCost } from '../src/estimator';

describe('estimateCost', () => {
  it('returns estimated cost and token count for anthropic', async () => {
    const result = await estimateCost({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'Hello world' }],
    });
    expect(result.estimatedInputTokens).toBeGreaterThan(0);
    expect(result.estimatedCostUSD).toBeGreaterThan(0);
    expect(typeof result.willBreachLimit).toBe('boolean');
  });
});
