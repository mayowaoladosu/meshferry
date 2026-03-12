import { randomBytes } from "node:crypto";

const adjectives = [
  "amber",
  "ancient",
  "brisk",
  "bright",
  "calm",
  "clever",
  "cosmic",
  "crisp",
  "curious",
  "daring",
  "electric",
  "ember",
  "fancy",
  "fast",
  "fuzzy",
  "gentle",
  "golden",
  "happy",
  "hidden",
  "icy",
  "jolly",
  "kind",
  "lucky",
  "lunar",
  "mellow",
  "midnight",
  "misty",
  "nimble",
  "odd",
  "orange",
  "playful",
  "proud",
  "quick",
  "quiet",
  "rapid",
  "restless",
  "river",
  "rusty",
  "sandy",
  "shiny",
  "silent",
  "silver",
  "solar",
  "steady",
  "stormy",
  "sunny",
  "swift",
  "tidy",
  "tiny",
  "unstable",
  "velvet",
  "vivid",
  "wandering",
  "wild",
  "wise",
  "witty",
  "young",
  "zesty"
];

const nouns = [
  "anchor",
  "banana",
  "breeze",
  "bridge",
  "brook",
  "canary",
  "castle",
  "cedar",
  "cloud",
  "comet",
  "coral",
  "delta",
  "dream",
  "falcon",
  "feather",
  "field",
  "firefly",
  "forest",
  "frog",
  "galaxy",
  "garden",
  "harbor",
  "hawk",
  "island",
  "jungle",
  "kernel",
  "lagoon",
  "lantern",
  "meadow",
  "meteor",
  "monkey",
  "mountain",
  "oasis",
  "orbit",
  "otter",
  "panda",
  "pebble",
  "phoenix",
  "pine",
  "planet",
  "rain",
  "reef",
  "rocket",
  "shadow",
  "signal",
  "sparrow",
  "stream",
  "sunset",
  "thunder",
  "tiger",
  "valley",
  "violet",
  "wave",
  "willow",
  "wind",
  "wolf"
];

export function generateReadableSubdomain(isAvailable: (value: string) => boolean): string {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const candidate = `${pick(adjectives)}-${pick(nouns)}`;
    if (candidate.length <= 32 && isAvailable(candidate)) {
      return candidate;
    }
  }

  for (let attempt = 0; attempt < 24; attempt += 1) {
    const candidate = `${pick(adjectives)}-${pick(nouns)}-${randomSuffix(2)}`;
    if (candidate.length <= 32 && isAvailable(candidate)) {
      return candidate;
    }
  }

  return `mf-${randomSuffix(10)}`;
}

function pick(values: string[]): string {
  return values[randomIndex(values.length)] ?? values[0] ?? "meshferry";
}

function randomIndex(length: number): number {
  return randomBytes(2).readUInt16BE(0) % length;
}

function randomSuffix(size: number): string {
  return randomBytes(size)
    .toString("base64url")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, Math.max(2, size * 2));
}
