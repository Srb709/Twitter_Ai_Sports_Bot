// Pricing per 1M tokens — claude-haiku-4-5
const ANTHROPIC = {
  input: 1.0,
  output: 5.0,
  cacheWrite: 1.25,
  cacheRead: 0.1,
};

// Pricing per 1M tokens — gpt-4o-mini (OpenAI fallback)
const OPENAI = {
  input: 0.15,
  output: 0.6,
};

// DB key format: ai_monthly_cost_2026_04
function monthKey(): string {
  const d = new Date();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `ai_monthly_cost_${d.getUTCFullYear()}_${mm}`;
}

function budget(): number {
  const v = parseFloat(process.env.CLAUDE_MONTHLY_BUDGET_USD ?? "20");
  return isNaN(v) ? 20 : v;
}

// ─── Public helpers ───────────────────────────────────────────────────────────

export async function getCurrentSpend(): Promise<number> {
  const { db } = await import("@sports-engine/db");
  const row = await db.systemSetting.findUnique({ where: { key: monthKey() } });
  return row ? parseFloat(row.value) : 0;
}

/** Throw BUDGET_EXCEEDED before making a call if we're already over limit. */
export async function checkBudget(estimatedCost: number): Promise<void> {
  const spend = await getCurrentSpend();
  const cap = budget();
  if (spend + estimatedCost > cap) {
    throw new Error(
      `BUDGET_EXCEEDED: $${spend.toFixed(4)} spent this month + ~$${estimatedCost.toFixed(4)} estimate > $${cap} cap. ` +
        `Resets next month or raise CLAUDE_MONTHLY_BUDGET_USD.`
    );
  }
}

/** Record actual Anthropic usage after a successful call. Returns cost in USD. */
export async function recordAnthropicUsage(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}): Promise<number> {
  const cost =
    (usage.input_tokens / 1_000_000) * ANTHROPIC.input +
    (usage.output_tokens / 1_000_000) * ANTHROPIC.output +
    ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) * ANTHROPIC.cacheWrite +
    ((usage.cache_read_input_tokens ?? 0) / 1_000_000) * ANTHROPIC.cacheRead;

  await addSpend(cost);
  return cost;
}

/** Record actual OpenAI usage after a successful call. Returns cost in USD. */
export async function recordOpenAiUsage(usage: {
  prompt_tokens: number;
  completion_tokens: number;
}): Promise<number> {
  const cost =
    (usage.prompt_tokens / 1_000_000) * OPENAI.input +
    (usage.completion_tokens / 1_000_000) * OPENAI.output;

  await addSpend(cost);
  return cost;
}

/** Rough pre-call estimate to check against the budget before spending. */
export function estimateCost(
  provider: "anthropic" | "openai",
  estInputTokens: number,
  maxOutputTokens: number
): number {
  if (provider === "openai") {
    return (
      (estInputTokens / 1_000_000) * OPENAI.input +
      (maxOutputTokens / 1_000_000) * OPENAI.output
    );
  }
  return (
    (estInputTokens / 1_000_000) * ANTHROPIC.input +
    (maxOutputTokens / 1_000_000) * ANTHROPIC.output
  );
}

// ─── Internal ─────────────────────────────────────────────────────────────────

async function addSpend(cost: number): Promise<void> {
  const { db } = await import("@sports-engine/db");
  const key = monthKey();
  const current = await getCurrentSpend();
  const next = (current + cost).toFixed(6);

  await db.systemSetting.upsert({
    where: { key },
    update: { value: next },
    create: { key, value: next },
  });

  const newTotal = parseFloat(next);
  const cap = budget();
  const warnAt = cap * 0.8;

  if (newTotal >= warnAt && current < warnAt) {
    console.warn(
      `[cost-guard] ⚠️  AI spend at $${newTotal.toFixed(4)} — 80% of $${cap} monthly budget.`
    );
  }
}
