import crypto from "node:crypto";

export const DEFAULT_API_KEY_TTL_DAYS = 90;

export function generateApiKey(expiresInDays = DEFAULT_API_KEY_TTL_DAYS) {
  const id = crypto.randomBytes(12).toString("base64url");
  const secret = crypto.randomBytes(32).toString("base64url");
  const key = `ft_${id}_${secret}`;

  return {
    id,
    key,
    secretHash: hashApiKey(key),
    expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
  };
}

export function parseApiKey(value: string) {
  const match = /^ft_([A-Za-z0-9_-]{16})_[A-Za-z0-9_-]{43}$/.exec(value);
  if (match) return { id: match[1], secretHash: hashApiKey(value) };

  // Legacy UUID keys survive only for the short migration grace period.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    const secretHash = hashApiKey(value);
    return { id: `legacy_${secretHash.slice(0, 16)}`, secretHash };
  }
  return null;
}

export function apiKeyHashMatches(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function hashApiKey(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
