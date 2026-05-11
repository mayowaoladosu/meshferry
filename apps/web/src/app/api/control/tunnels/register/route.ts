import { requireControlToken } from "@/lib/control-auth";
import { registerTunnel } from "@/lib/store";
import { NextResponse } from "next/server";
import { z } from "zod";

const registerSchema = z.object({
  id: z.string().min(3),
  orgId: z.string().min(3),
  protocol: z.enum(["http", "tcp", "udp"]),
  subdomain: z.string().optional(),
  target: z.string().min(3),
  publicUrl: z.string().optional(),
  fallbackUrl: z.string().optional(),
  publicHost: z.string().optional(),
  publicPort: z.number().int().min(1).max(65535).optional(),
  gatewayId: z.string().min(3)
});

export async function POST(request: Request) {
  const unauthorized = requireControlToken(request);
  if (unauthorized) return unauthorized;

  const parsed = registerSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  const tunnel = await registerTunnel(parsed.data);
  return NextResponse.json({ tunnel });
}
