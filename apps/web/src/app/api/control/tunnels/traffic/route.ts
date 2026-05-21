import { requireControlToken } from "@/lib/control-auth";
import { recordTunnelTraffic } from "@/lib/store";
import { NextResponse } from "next/server";
import { z } from "zod";

const trafficSchema = z.object({
  id: z.string().min(3),
  requests: z.number().int().min(0).optional(),
  bytesIn: z.number().int().min(0).optional(),
  bytesOut: z.number().int().min(0).optional(),
  eventType: z.string().min(2).max(80).optional(),
  method: z.string().min(1).max(16).optional(),
  path: z.string().min(1).max(2048).optional(),
  status: z.number().int().min(100).max(599).optional(),
  durationMs: z.number().int().min(0).optional()
});

export async function POST(request: Request) {
  const unauthorized = requireControlToken(request);
  if (unauthorized) return unauthorized;

  const parsed = trafficSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const tunnel = await recordTunnelTraffic(parsed.data);
  return NextResponse.json({ tunnel });
}
