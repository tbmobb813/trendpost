import { lookup } from 'node:dns/promises';
import { isIPv4 } from 'node:net';

// Blocks the classic SSRF targets for a self-hosted app that fetches
// arbitrary operator-supplied URLs: cloud metadata endpoints
// (169.254.169.254), localhost, and RFC1918/ULA internal ranges. Checked
// against the *resolved* address, not the hostname string, so
// "http://2130706433/" (decimal-encoded 127.0.0.1) and DNS records pointing
// a public-looking name at a private IP are both caught.
function isPrivateAddress(address: string): boolean {
  if (isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    if (a === 127) return true; // loopback
    if (a === 10) return true; // RFC1918
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 169 && b === 254) return true; // link-local incl. cloud metadata
    if (a === 0) return true; // "this network"
    return false;
  }
  // IPv6
  const addr = address.toLowerCase();
  if (addr === '::1') return true; // loopback
  if (addr.startsWith('fe80:') || addr.startsWith('fe80::')) return true; // link-local
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true; // unique local (fc00::/7)
  if (addr.startsWith('::ffff:')) return isPrivateAddress(addr.slice(7)); // IPv4-mapped
  return false;
}

/** Throws if `urlString` isn't a safe http(s) URL to fetch server-side. */
export async function assertSafeToFetch(urlString: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error(`"${urlString}" is not a valid URL.`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Refusing to fetch "${urlString}" — only http/https URLs are allowed.`);
  }

  let addresses: string[];
  try {
    const results = await lookup(parsed.hostname, { all: true, verbatim: true });
    addresses = results.map((r) => r.address);
  } catch {
    throw new Error(`Could not resolve host "${parsed.hostname}".`);
  }

  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error(
      `Refusing to fetch "${urlString}" — it resolves to a private or internal address.`
    );
  }
}
