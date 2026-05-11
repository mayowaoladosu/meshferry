import { getDeviceLinkStatus } from "@/lib/store";
import { gatewayWebSocketUrl } from "@/lib/utils";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim().toUpperCase();
  const deviceId = url.searchParams.get("deviceId")?.trim();

  if (!code || !deviceId) {
    return NextResponse.json({ error: "missing_code_or_device" }, { status: 400 });
  }

  const link = await getDeviceLinkStatus(code, deviceId);
  if (!link) {
    return NextResponse.json({ status: "expired" });
  }

  return NextResponse.json({
    status: link.status,
    token: link.status === "approved" ? link.apiToken : undefined,
    orgId: link.status === "approved" ? link.orgId : undefined,
    gatewayUrl: gatewayWebSocketUrl()
  });
}
