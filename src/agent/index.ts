#!/usr/bin/env node

import { createAgentConfig, runAgent, type AgentConfig } from "./core.js";

const agentConfig = createAgentConfig(parseLegacyArgs(process.argv.slice(2)));
process.exitCode = await runAgent(agentConfig);

function parseLegacyArgs(argv: string[]): Partial<AgentConfig> {
  const parsed: Partial<AgentConfig> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];
    if (!current?.startsWith("--") || !next) {
      continue;
    }

    if (current === "--server" || current === "--local" || current === "--subdomain" || current === "--token") {
      parsed[current.slice(2) as keyof AgentConfig] = next;
      index += 1;
    }
  }

  return parsed;
}
