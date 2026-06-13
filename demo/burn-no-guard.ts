import Anthropic from "@anthropic-ai/sdk";

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const anthropic = new Anthropic({ apiKey });

  for (let i = 1; i <= 20; i++) {
    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 50,
      messages: [{ role: "user", content: "say hello" }],
    });
    console.log(`✅ Request ${i}/20 — cost accumulating, no limit set...`);
  }
}

main().catch(console.error);