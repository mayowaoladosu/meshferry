import { z } from "zod";

export const tunnelProtocolSchema = z.enum(["http", "tcp", "udp"]);
export type TunnelProtocol = z.infer<typeof tunnelProtocolSchema>;

export const agentRegisterSchema = z.object({
  type: z.literal("agent.register"),
  token: z.string().min(8),
  protocol: tunnelProtocolSchema,
  subdomain: z.string().min(3).max(63).optional(),
  localHost: z.string().default("127.0.0.1"),
  localPort: z.number().int().min(1).max(65535),
  publicPort: z.number().int().min(1).max(65535).optional(),
  orgId: z.string().optional(),
  clientVersion: z.string().optional()
});

export type AgentRegisterMessage = z.infer<typeof agentRegisterSchema>;

export type AgentRegisteredMessage = {
  type: "agent.registered";
  tunnelId: string;
  protocol: TunnelProtocol;
  subdomain?: string;
  publicUrl?: string;
  fallbackUrl?: string;
  publicHost?: string;
  publicPort?: number;
};

export type GatewayErrorMessage = {
  type: "gateway.error";
  code: string;
  message: string;
};

export type HttpProxyRequestMessage = {
  type: "proxy.http.request";
  requestId: string;
  method: string;
  path: string;
  headers: Record<string, string | string[]>;
  body: string;
};

export type HttpProxyResponseMessage = {
  type: "proxy.http.response";
  requestId: string;
  status: number;
  headers: Record<string, string | string[]>;
  body: string;
};

export type TcpOpenMessage = {
  type: "proxy.tcp.open";
  streamId: string;
};

export type TcpDataMessage = {
  type: "proxy.tcp.data";
  streamId: string;
  body: string;
};

export type TcpCloseMessage = {
  type: "proxy.tcp.close";
  streamId: string;
  error?: string;
};

export type UdpPacketMessage = {
  type: "proxy.udp.packet";
  remoteId: string;
  body: string;
};

export type AgentToGatewayMessage =
  | AgentRegisterMessage
  | HttpProxyResponseMessage
  | TcpDataMessage
  | TcpCloseMessage
  | UdpPacketMessage;

export type GatewayToAgentMessage =
  | AgentRegisteredMessage
  | GatewayErrorMessage
  | HttpProxyRequestMessage
  | TcpOpenMessage
  | TcpDataMessage
  | TcpCloseMessage
  | UdpPacketMessage;

export function encodeBody(body: Uint8Array): string {
  return Buffer.from(body).toString("base64");
}

export function decodeBody(body: string): Buffer {
  return Buffer.from(body, "base64");
}

export function isJsonMessage(value: unknown): value is { type: string } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "type" in value &&
      typeof (value as { type?: unknown }).type === "string"
  );
}

export function parseJsonMessage(raw: Buffer | ArrayBuffer | Buffer[]): unknown {
  const value = Array.isArray(raw)
    ? Buffer.concat(raw)
    : Buffer.isBuffer(raw)
      ? raw
      : Buffer.from(new Uint8Array(raw));
  return JSON.parse(value.toString("utf8"));
}
