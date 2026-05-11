import { getViewer } from "@/lib/auth";
import { approveDeviceLink, StoreError } from "@/lib/store";
import { gatewayWebSocketUrl } from "@/lib/utils";
import { NextResponse } from "next/server";
import { z } from "zod";

const confirmSchema = z.object({
  code: z.string().min(8)
});

export async function POST(request: Request) {
  const viewer = await getViewer();
  const parsed = confirmSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const link = await approveDeviceLink(parsed.data.code.trim().toUpperCase(), viewer.orgId);
    return NextResponse.json({
      code: link.code,
      status: link.status,
      token: link.apiToken,
      orgId: link.orgId,
      gatewayUrl: gatewayWebSocketUrl()
    });
  } catch (error) {
    if (error instanceof StoreError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: 400 });
    }

    throw error;
  }
}
