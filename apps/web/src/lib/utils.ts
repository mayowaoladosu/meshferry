import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function absoluteUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return new URL(path, base).toString();
}

export function gatewayHttpUrl(): string {
  return process.env.NEXT_PUBLIC_GATEWAY_URL ?? "http://localhost:4040";
}

export function gatewayWebSocketUrl(): string {
  const value = gatewayHttpUrl();
  if (value.startsWith("https://")) return value.replace("https://", "wss://") + "/agent";
  if (value.startsWith("http://")) return value.replace("http://", "ws://") + "/agent";
  return value;
}
