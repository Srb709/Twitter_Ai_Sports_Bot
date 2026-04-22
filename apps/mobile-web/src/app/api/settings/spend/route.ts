import { NextResponse } from "next/server";
import { db } from "@sports-engine/db";

export async function GET() {
  const now = new Date();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const monthKey = `ai_monthly_cost_${now.getUTCFullYear()}_${mm}`;

  const row = await db.systemSetting.findUnique({ where: { key: monthKey } });
  const currentSpendUsd = row ? parseFloat(row.value) : 0;
  const budgetUsd = parseFloat(process.env.CLAUDE_MONTHLY_BUDGET_USD ?? "20");

  return NextResponse.json({
    currentSpendUsd,
    budgetUsd,
    percentUsed: (currentSpendUsd / budgetUsd) * 100,
    monthKey,
  });
}
