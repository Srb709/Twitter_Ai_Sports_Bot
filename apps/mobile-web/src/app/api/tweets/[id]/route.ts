import { NextRequest, NextResponse } from "next/server";
import { db } from "@sports-engine/db";
import { z } from "zod";

const patchSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED", "DRAFT"]),
  approvalNote: z.string().optional(),
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

  const draft = await db.tweetDraft.update({
    where: { id: params.id },
    data: {
      status: parsed.data.status as never,
      approvalNote: parsed.data.approvalNote,
    },
  });

  return NextResponse.json({ draft });
}
