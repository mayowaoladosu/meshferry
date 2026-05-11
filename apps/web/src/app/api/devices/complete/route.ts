import { completeDeviceLink, StoreError } from "@/lib/store";
import { NextResponse } from "next/server";
import { z } from "zod";

const completeSchema = z.object({
  code: z.string().min(8),
  deviceId: z.string().min(3),
  deviceName: z.string().optional(),
  platform: z.string().optional()
});

export async function POST(request: Request) {
  const parsed = completeSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const link = await completeDeviceLink({
      ...parsed.data,
      code: parsed.data.code.trim().toUpperCase()
    });

    return NextResponse.json({
      code: link.code,
      status: link.status,
      deviceName: link.deviceName,
      terminalSeenAt: link.terminalSeenAt
    });
  } catch (error) {
    if (error instanceof StoreError) {
      return NextResponse.json({ error: error.code, message: error.message }, { status: 400 });
    }

    throw error;
  }
}
