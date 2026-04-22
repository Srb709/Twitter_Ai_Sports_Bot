import { NextRequest, NextResponse } from "next/server";
import { db } from "@sports-engine/db";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? "DRAFT";

  const drafts = await db.tweetDraft.findMany({
    where: { status: status as never },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ drafts });
}
