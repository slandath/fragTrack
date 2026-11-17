// Retailer URL validation and canonicalization (Spec 03).
//
// Canonical form is conservative: the URL standard form with the fragment
// dropped and default ports removed. Host casing is lowercased by URL
// parsing; path and query casing and content are preserved because
// retailers may need query parameters to identify a product.

export const MAX_URL_LENGTH = 2048;

/**
 * Return the `www.`-stripped hostname used as the key in `domainConfigs`.
 * The domain is derived once, from the validated canonical URL, and stored on
 * `retailer_url` so no separate retailer lookup is needed (Spec 07).
 */
export function retailerDomainOf(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}

/**
 * Validate a retailer URL and return its canonical storage form.
 * Throws an Error with a user-facing message when the URL is invalid.
 * `supportedDomains` uses the existing www.-stripped hostname keys.
 */
export function canonicalizeRetailerUrl(
  raw: unknown,
  supportedDomains: Record<string, unknown>,
): string {
  if (typeof raw !== "string") throw new Error("URL must be a string");
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("URL must not be empty");
  if (trimmed.length > MAX_URL_LENGTH) {
    throw new Error(`URL must be at most ${MAX_URL_LENGTH} characters`);
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("URL must be a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must use http or https");
  }
  if (url.username || url.password) {
    throw new Error("URL must not contain credentials");
  }
  const host = url.hostname.replace(/^www\./, "");
  // Own-property check: inherited Object.prototype names (e.g.
  // "constructor") must not pass as configured retailers.
  if (!Object.hasOwn(supportedDomains, host)) {
    throw new Error(`"${host}" is not a supported domain`);
  }
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }
  url.hash = "";
  return url.toString();
}
