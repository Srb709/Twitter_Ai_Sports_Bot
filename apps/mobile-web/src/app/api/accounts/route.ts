import { NextResponse } from "next/server";
import { db } from "@sports-engine/db";

export async function GET() {
  const accounts = await db.trackedAccount.findMany({
    orderBy: [{ priority: "asc" }, { username: "asc" }],
  });

  return NextResponse.json({ accounts });
}
