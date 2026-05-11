const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createReadableCode(prefix = "MF"): string {
  return `${prefix}-${chunk(randomString(12), 4).join("-")}`;
}

export function createApiToken(prefix = "mf_live"): string {
  return `${prefix}_${randomString(40).toLowerCase()}`;
}

export function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;

  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return result === 0;
}

function randomString(length: number): string {
  const crypto = globalThis.crypto;
  const bytes = new Uint8Array(length);

  if (crypto?.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(bytes, (byte) => alphabet.charAt(byte % alphabet.length)).join("");
}

function chunk(value: string, size: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += size) {
    chunks.push(value.slice(index, index + size));
  }

  return chunks;
}
