import { access, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { parse } from "yaml";

export interface TunnelProfileConfig {
  local?: string | number;
  subdomain?: string;
}

export interface MeshFerryFileConfig {
  server?: string;
  token?: string;
  subdomain?: string;
  local?: string | number;
  tunnel?: TunnelProfileConfig;
  tunnels?: Record<string, TunnelProfileConfig | undefined>;
}

export interface LoadedMeshFerryConfig {
  path: string;
  config: MeshFerryFileConfig;
}

const CONFIG_FILES = [
  "meshferry.yml",
  "meshferry.yaml",
  ".meshferry.yml",
  ".meshferry.yaml",
  "meshferry.json"
];

export async function loadMeshFerryConfig(explicitPath?: string): Promise<LoadedMeshFerryConfig | null> {
  const configPath = explicitPath ? resolve(process.cwd(), explicitPath) : await findConfigPath();
  if (!configPath) {
    return null;
  }

  const raw = await readFile(configPath, "utf8");
  const parsed = parse(raw);
  const config = isRecord(parsed) ? (parsed as MeshFerryFileConfig) : {};

  return {
    path: configPath,
    config
  };
}

export function pickTunnelProfile(config: MeshFerryFileConfig, name?: string): TunnelProfileConfig | null {
  if (name) {
    return config.tunnels?.[name] ?? null;
  }

  if (isTunnelProfile(config.tunnel)) {
    return config.tunnel;
  }

  if (isTunnelProfile(config.tunnels?.default)) {
    return config.tunnels?.default ?? null;
  }

  const entries = Object.entries(config.tunnels ?? {}).filter(([, profile]) => isTunnelProfile(profile));
  if (entries.length === 1) {
    return entries[0]?.[1] ?? null;
  }

  return null;
}

export function deriveSubdomain(seedPath: string): string {
  const raw = basename(seedPath).toLowerCase();
  let slug = raw.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  if (!slug) {
    slug = "app";
  }

  if (slug.length < 3) {
    slug = `${slug}-app`;
  }

  slug = slug.slice(0, 32).replace(/^-+|-+$/g, "");

  if (!slug) {
    return "app-dev";
  }

  if (!/^[a-z0-9]/.test(slug)) {
    slug = `a${slug}`;
  }

  if (!/[a-z0-9]$/.test(slug)) {
    slug = `${slug}a`;
  }

  return slug.slice(0, 32);
}

export function deriveTargetSubdomain(target: string | number, fallbackSeedPath: string, preferredName?: string): string {
  if (preferredName) {
    return deriveSubdomain(preferredName);
  }

  const port = extractPortFromTarget(target);
  if (port) {
    return port;
  }

  return deriveSubdomain(fallbackSeedPath);
}

export function readConfigValue(value: string | number | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return `${value}`;
}

async function findConfigPath(): Promise<string | null> {
  for (const candidate of CONFIG_FILES) {
    const fullPath = resolve(process.cwd(), candidate);
    try {
      await access(fullPath);
      return fullPath;
    } catch {
      continue;
    }
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTunnelProfile(value: unknown): value is TunnelProfileConfig {
  return isRecord(value);
}

function extractPortFromTarget(target: string | number): string | null {
  const value = `${target}`.trim();

  if (/^\d+$/.test(value)) {
    return value;
  }

  if (/^:\d+$/.test(value)) {
    return value.slice(1);
  }

  if (!/^https?:\/\//.test(value)) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.port || null;
  } catch {
    return null;
  }
}
