import { NextRequest, NextResponse } from "next/server";
import { db } from "@sports-engine/db";
import { z } from "zod";

const patchSchema = z.object({
  active: z.boolean().optional(),
  priority: z.number().int().min(1).max(100).optional(),
  notes: z.string().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const account = await db.trackedAccount.update({
    where: { id: params.id },
    data: parsed.data,
  });

  return NextResponse.json({ account });
}
