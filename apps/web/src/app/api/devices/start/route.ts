import { getViewer } from "@/lib/auth";
import { absoluteUrl, gatewayWebSocketUrl } from "@/lib/utils";
import { createDeviceLink, ensureOrganization } from "@/lib/store";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const viewer = await getViewer();
  const organization = await ensureOrganization(viewer);
  const body = (await request.json().catch(() => ({}))) as {
    deviceId?: string;
    deviceName?: string;
    platform?: string;
  };

  const link = await createDeviceLink({
    orgId: organization.id,
    deviceId: body.deviceId,
    deviceName: body.deviceName,
    platform: body.platform
  });

  return NextResponse.json({
    code: link.code,
    status: link.status,
    dashboardUrl: absoluteUrl(`/connect/${encodeURIComponent(link.code)}`),
    gatewayUrl: gatewayWebSocketUrl(),
    connectCommand: `meshferry connect --code ${link.code}`
  });
}
