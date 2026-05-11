import { requireControlToken } from "@/lib/control-auth";
import { StoreError, validateAgentToken } from "@/lib/store";
import { NextResponse } from "next/server";
import { z } from "zod";

const validateSchema = z.object({
  token: z.string().min(8),
  orgId: z.string().optional(),
  subdomain: z.string().optional()
});

export async function POST(request: Request) {
  const unauthorized = requireControlToken(request);
  if (unauthorized) return unauthorized;

  const parsed = validateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const result = await validateAgentToken(parsed.data);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof StoreError) {
      return NextResponse.json({ ok: false, error: error.code, message: error.message }, { status: 403 });
    }

    throw error;
  }
}
