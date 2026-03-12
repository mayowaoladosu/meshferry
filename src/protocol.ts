import type { IncomingHttpHeaders } from "node:http";

export interface ProxyRequestMessage {
  type: "proxy-request";
  requestId: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface ProxyResponseMessage {
  type: "proxy-response";
  requestId: string;
  status: number;
  headers: Record<string, string>;
  body: string | null;
}

export interface RegisteredMessage {
  type: "registered";
  subdomain: string;
  publicUrl: string;
  pathUrl: string;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export type ServerMessage = ProxyRequestMessage | RegisteredMessage | ErrorMessage;
export type ClientMessage = ProxyResponseMessage | ErrorMessage;
export type TunnelMessage = ServerMessage | ClientMessage;

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

export function isHopByHopHeader(name: string): boolean {
  return hopByHopHeaders.has(name.toLowerCase());
}

export function encodeBody(body: Buffer): string | null {
  return body.length > 0 ? body.toString("base64") : null;
}

export function decodeBody(body: string | null | undefined): Buffer {
  return body ? Buffer.from(body, "base64") : Buffer.alloc(0);
}

export function sanitizeIncomingRequestHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const clean: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (!value || isHopByHopHeader(name) || lower === "host" || lower === "accept-encoding") {
      continue;
    }

    clean[lower] = Array.isArray(value) ? value.join(", ") : value;
  }

  return clean;
}

export function sanitizeOutgoingResponseHeaders(headers: Headers): Record<string, string> {
  const clean: Record<string, string> = {};

  headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (isHopByHopHeader(name) || lower === "content-length" || lower === "content-encoding") {
      return;
    }

    clean[lower] = value;
  });

  return clean;
}

export function sanitizeAgentResponseHeaders(headers: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (isHopByHopHeader(name) || lower === "content-length" || lower === "content-encoding") {
      continue;
    }

    clean[lower] = value;
  }

  return clean;
}

export function readJsonMessage(raw: Buffer | ArrayBuffer | Buffer[]): TunnelMessage {
  let payload: Buffer;

  if (Array.isArray(raw)) {
    payload = Buffer.concat(raw.map((chunk) => Buffer.from(chunk)));
  } else if (raw instanceof ArrayBuffer) {
    payload = Buffer.from(raw);
  } else {
    payload = Buffer.from(raw);
  }

  return JSON.parse(payload.toString("utf8")) as TunnelMessage;
}
