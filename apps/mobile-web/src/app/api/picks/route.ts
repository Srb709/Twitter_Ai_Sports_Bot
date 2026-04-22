import { NextResponse } from "next/server";
import { db } from "@sports-engine/db";

export async function GET() {
  const picks = await db.extractedPick.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ picks });
}
