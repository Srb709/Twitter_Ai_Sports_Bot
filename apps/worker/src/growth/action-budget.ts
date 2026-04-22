/**
 * Daily action budget enforcer.
 * Stored in SystemSetting as daily_<type>_YYYY_MM_DD keys.
 * Limits ramp up automatically as the account ages to avoid new-account flags.
 */
import { db } from "@sports-engine/db";

export type ActionType = "FOLLOW" | "UNFOLLOW" | "LIKE" | "REPLY" | "POST";

// Hard daily limits per action type at full maturity (account age > 60 days)
const MATURE_LIMITS: Record<ActionType, number> = {
  FOLLOW:   80,
  UNFOLLOW: 80,
  LIKE:     250,
  REPLY:    40,
  POST:     12,
};

// Ramp-up schedule: fraction of mature limit to apply by account age bucket
function rampFactor(accountAgeDays: number): number {
  if (accountAgeDays < 3)  return 0.10;  // brand new — almost nothing
  if (accountAgeDays < 7)  return 0.20;
  if (accountAgeDays < 14) return 0.35;
  if (accountAgeDays < 30) return 0.55;
  if (accountAgeDays < 60) return 0.75;
  return 1.0;
}

function dayKey(type: ActionType): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, "0")}_${String(d.getUTCDate()).padStart(2, "0")}`;
  return `daily_${type.toLowerCase()}_${ymd}`;
}

async function getCount(type: ActionType): Promise<number> {
  const row = await db.systemSetting.findUnique({ where: { key: dayKey(type) } });
  return row ? parseInt(row.value, 10) : 0;
}

async function increment(type: ActionType): Promise<void> {
  const key = dayKey(type);
  const current = await getCount(type);
  await db.systemSetting.upsert({
    where: { key },
    update: { value: String(current + 1) },
    create: { key, value: "1" },
  });
}

/** Returns true if we still have budget for this action today. */
export async function canAct(type: ActionType): Promise<boolean> {
  const ageDays = getAccountAgeDays();
  const limit = Math.floor(MATURE_LIMITS[type] * rampFactor(ageDays));
  const used = await getCount(type);
  return used < limit;
}

/** Record that we performed an action (increments daily counter + writes GrowthAction row). */
export async function recordAction(opts: {
  type: ActionType;
  targetUsername?: string;
  targetPostKey?: string;
  replyText?: string;
  success?: boolean;
}): Promise<void> {
  await increment(opts.type);
  await db.growthAction.create({
    data: {
      actionType: opts.type as never,
      targetUsername: opts.targetUsername,
      targetPostKey: opts.targetPostKey,
      replyText: opts.replyText,
      success: opts.success ?? true,
    },
  });
}

/** How many actions of this type remain today. */
export async function remaining(type: ActionType): Promise<number> {
  const ageDays = getAccountAgeDays();
  const limit = Math.floor(MATURE_LIMITS[type] * rampFactor(ageDays));
  const used = await getCount(type);
  return Math.max(0, limit - used);
}

/** Returns today's usage summary for logging. */
export async function dailySummary(): Promise<string> {
  const types: ActionType[] = ["FOLLOW", "UNFOLLOW", "LIKE", "REPLY", "POST"];
  const parts = await Promise.all(
    types.map(async (t) => {
      const used = await getCount(t);
      const ageDays = getAccountAgeDays();
      const limit = Math.floor(MATURE_LIMITS[t] * rampFactor(ageDays));
      return `${t}: ${used}/${limit}`;
    })
  );
  return parts.join(" | ");
}

function getAccountAgeDays(): number {
  const created = process.env.ACCOUNT_CREATED_DATE;
  if (!created) return 0;
  const ms = Date.now() - new Date(created).getTime();
  return Math.floor(ms / 86_400_000);
}
