import { NextResponse } from "next/server";
import { db } from "@sports-engine/db";

export async function GET() {
  const d = new Date();
  const key = `briefing_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, "0")}_${String(d.getUTCDate()).padStart(2, "0")}`;

  const row = await db.systemSetting.findUnique({ where: { key } });

  if (!row) {
    return NextResponse.json({ briefing: null });
  }

  try {
    const briefing = JSON.parse(row.value);
    return NextResponse.json({ briefing });
  } catch {
    return NextResponse.json({ briefing: null });
  }
}
