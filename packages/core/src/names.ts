const reservedSubdomains = new Set([
  "admin",
  "api",
  "app",
  "auth",
  "billing",
  "cdn",
  "dashboard",
  "docs",
  "gateway",
  "mail",
  "meshferry",
  "root",
  "status",
  "support",
  "www"
]);

const adjectives = [
  "amber",
  "bright",
  "calm",
  "cobalt",
  "direct",
  "fresh",
  "green",
  "level",
  "prime",
  "rapid",
  "steady",
  "violet"
];

const nouns = [
  "bridge",
  "harbor",
  "jetty",
  "lane",
  "link",
  "pier",
  "route",
  "signal",
  "span",
  "waypoint",
  "wire",
  "yard"
];

export type SubdomainCheck =
  | { ok: true; value: string }
  | { ok: false; value: string; reason: string };

export function normalizeSubdomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function validateSubdomain(input: string): SubdomainCheck {
  const value = normalizeSubdomain(input);

  if (value.length < 3) {
    return { ok: false, value, reason: "Use at least 3 characters." };
  }

  if (value.length > 63) {
    return { ok: false, value, reason: "Use 63 characters or fewer." };
  }

  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/.test(value)) {
    return {
      ok: false,
      value,
      reason: "Use lowercase letters, numbers, and hyphens only."
    };
  }

  if (reservedSubdomains.has(value)) {
    return { ok: false, value, reason: "That subdomain is reserved." };
  }

  return { ok: true, value };
}

export function generateTunnelName(): string {
  const adjective = adjectives[randomInt(adjectives.length)] ?? "rapid";
  const noun = nouns[randomInt(nouns.length)] ?? "bridge";
  const suffix = randomInt(8999) + 1000;
  return `${adjective}-${noun}-${suffix}`;
}

function randomInt(max: number): number {
  const crypto = globalThis.crypto;
  if (crypto?.getRandomValues) {
    const buffer = new Uint32Array(1);
    crypto.getRandomValues(buffer);
    return Number((buffer[0] ?? 0) % max);
  }

  return Math.floor(Math.random() * max);
}
