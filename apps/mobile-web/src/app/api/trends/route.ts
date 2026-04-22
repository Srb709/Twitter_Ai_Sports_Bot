import { NextResponse } from "next/server";
import { db } from "@sports-engine/db";

export async function GET() {
  const clusters = await db.pickCluster.findMany({
    orderBy: { trendScore: "desc" },
    take: 50,
  });

  return NextResponse.json({ clusters });
}
