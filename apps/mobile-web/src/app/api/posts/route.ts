import { NextResponse } from "next/server";
import { db } from "@sports-engine/db";

export async function GET() {
  const posts = await db.sourcePost.findMany({
    orderBy: { scrapedAt: "desc" },
    take: 100,
    include: { trackedAccount: { select: { username: true } } },
  });

  return NextResponse.json({ posts });
}
