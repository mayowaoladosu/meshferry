import { requireControlToken } from "@/lib/control-auth";
import { markTunnelOffline } from "@/lib/store";
import { NextResponse } from "next/server";
import { z } from "zod";

const offlineSchema = z.object({
  id: z.string().min(3)
});

export async function POST(request: Request) {
  const unauthorized = requireControlToken(request);
  if (unauthorized) return unauthorized;

  const parsed = offlineSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const tunnel = await markTunnelOffline(parsed.data.id);
  return NextResponse.json({ tunnel });
}
