import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export type MeshferryConfig = {
  apiUrl: string;
  gatewayUrl: string;
  orgId?: string;
  token?: string;
  deviceId: string;
};

const configDirectory = path.join(homedir(), ".meshferry");
const configPath = path.join(configDirectory, "config.json");

export async function loadConfig(): Promise<MeshferryConfig> {
  try {
    const raw = await readFile(configPath, "utf8");
    return JSON.parse(raw) as MeshferryConfig;
  } catch {
    return {
      apiUrl: process.env.MESHFERRY_API_URL ?? "http://localhost:3000",
      gatewayUrl: process.env.MESHFERRY_GATEWAY_URL ?? "ws://localhost:4040/agent",
      deviceId: createDeviceId()
    };
  }
}

export async function saveConfig(config: MeshferryConfig): Promise<void> {
  await mkdir(configDirectory, { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
}

export function configFilePath(): string {
  return configPath;
}

function createDeviceId(): string {
  const suffix = Math.random().toString(36).slice(2, 10);
  return `mf_device_${suffix}`;
}
