export const PREFIX = "/atlas/";

export function encode(url) {
  return Buffer.from(encodeURIComponent(url))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export function decode(encoded) {
  const padded = encoded + "=".repeat((4 - (encoded.length % 4)) % 4);
  return decodeURIComponent(
    Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
  );
}

export function rewriteUrl(url, base) {
  if (!url) return url;
  const trimmed = url.trim();
  if (
    trimmed.startsWith("javascript:") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("mailto:") ||
    trimmed.startsWith("tel:") ||
    trimmed.startsWith("about:") ||
    trimmed.startsWith(PREFIX)
  ) {
    return url;
  }

  try {
    const resolved = base ? new URL(trimmed, base).href : new URL(trimmed).href;
    return PREFIX + encode(resolved);
  } catch {
    return url;
  }
}

export function unrewriteUrl(url) {
  if (!url || !url.startsWith(PREFIX)) return url;
  try {
    const raw = url.slice(PREFIX.length).split("?")[0].split("#")[0];
    return decode(raw);
  } catch {
    return url;
  }
}
