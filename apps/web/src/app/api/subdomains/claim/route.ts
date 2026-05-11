import { getViewer } from "@/lib/auth";
import { claimSubdomain, StoreError } from "@/lib/store";
import { NextResponse } from "next/server";
import { z } from "zod";

const claimSchema = z.object({
  slug: z.string().min(1)
});

export async function POST(request: Request) {
  const viewer = await getViewer();
  const parsed = claimSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const reservation = await claimSubdomain(parsed.data.slug, viewer.orgId);
    return NextResponse.json({ reservation });
  } catch (error) {
    if (error instanceof StoreError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: 400 });
    }

    throw error;
  }
}
