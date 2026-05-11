import { constantTimeEqual } from "@meshferry/core";
import { NextResponse } from "next/server";

export function requireControlToken(request: Request): NextResponse | undefined {
  const expected = process.env.MESHFERRY_CONTROL_API_TOKEN ?? "dev-control-token";
  const header = request.headers.get("authorization") ?? "";
  const actual = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";

  if (!actual || !constantTimeEqual(actual, expected)) {
    return NextResponse.json({ error: "control_unauthorized" }, { status: 401 });
  }

  return undefined;
}
