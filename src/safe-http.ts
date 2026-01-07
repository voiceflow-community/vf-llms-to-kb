import axios, { AxiosInstance } from 'axios';
import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';
import { URL } from 'url';

type SafeUrlOptions = {
  allowHttp?: boolean;
  allowHttps?: boolean;
};

function isPrivateOrLocalIpv4(ip: string): boolean {
  const parts = ip.split('.').map(n => Number(n));
  if (parts.length !== 4 || parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;

  // Unspecified / loopback
  if (a === 0) return true;
  if (a === 127) return true;

  // RFC1918 private
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;

  // Link-local
  if (a === 169 && b === 254) return true;

  // Carrier-grade NAT (100.64.0.0/10)
  if (a === 100 && b >= 64 && b <= 127) return true;

  // Multicast (224.0.0.0/4) and reserved (240.0.0.0/4)
  if (a >= 224) return true;

  return false;
}

function isPrivateOrLocalIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  // Loopback / unspecified
  if (normalized === '::1') return true;
  if (normalized === '::') return true;

  // Unique local addresses (fc00::/7)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

  // Link-local (fe80::/10)
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb'))
    return true;

  // Documentation prefix (2001:db8::/32)
  if (normalized.startsWith('2001:db8:')) return true;

  return false;
}

function isIpBlocked(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isPrivateOrLocalIpv4(ip);
  if (family === 6) return isPrivateOrLocalIpv6(ip);
  return true;
}

export function assertSafeOutboundUrl(urlString: string, opts: SafeUrlOptions = {}): void {
  const allowHttp = opts.allowHttp ?? true;
  const allowHttps = opts.allowHttps ?? true;

  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error('Invalid URL.');
  }

  const protocolOk =
    (allowHttps && url.protocol === 'https:') ||
    (allowHttp && url.protocol === 'http:');
  if (!protocolOk) {
    throw new Error('URL protocol not allowed.');
  }

  // Disallow credentialed URLs (e.g. https://user:pass@host/)
  if (url.username || url.password) {
    throw new Error('URL credentials are not allowed.');
  }

  const hostname = url.hostname.trim().toLowerCase();
  if (!hostname) {
    throw new Error('URL hostname is required.');
  }

  // Block obvious local hostnames early
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Localhost URLs are not allowed.');
  }

  // If hostname is an IP literal, block private/local ranges
  if (net.isIP(hostname)) {
    if (isIpBlocked(hostname)) {
      throw new Error('Private or local network URLs are not allowed.');
    }
  }
}

function safeLookup(
  hostname: string,
  options: unknown,
  callback:
    | ((err: NodeJS.ErrnoException | null, address: string, family: number) => void)
    | ((err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void)
): void {
  // Node's lookup signature is overloaded: (hostname, cb) or (hostname, options, cb)
  if (typeof options === 'function') {
    // @ts-expect-error runtime overload
    return safeLookup(hostname, {}, options);
  }

  const baseOptions =
    typeof options === 'number'
      ? ({ family: options } as dns.LookupOptions)
      : ({ ...(options as any) } as dns.LookupOptions);

  const wantsAll = !!(baseOptions as any).all;

  // Always resolve all, then filter out private/local addresses.
  dns.lookup(hostname, { ...baseOptions, all: true } as dns.LookupAllOptions, (err, addresses: dns.LookupAddress[]) => {
    if (err) return (callback as any)(err);

    const safeAddresses = addresses.filter((a: dns.LookupAddress) => !isIpBlocked(a.address));
    if (safeAddresses.length === 0) {
      const blockedErr: NodeJS.ErrnoException = new Error('Blocked private/local DNS resolution.');
      blockedErr.code = 'EHOSTUNREACH';
      return (callback as any)(blockedErr);
    }

    if (wantsAll) {
      return (callback as any)(null, safeAddresses);
    }

    const first = safeAddresses[0];
    return (callback as any)(null, first.address, first.family);
  });
}

const safeHttpAgent = new http.Agent({ keepAlive: true, lookup: safeLookup });
const safeHttpsAgent = new https.Agent({ keepAlive: true, lookup: safeLookup });

export const safeAxios: AxiosInstance = axios.create({
  timeout: 15_000,
  maxRedirects: 0, // Prevent redirect-based SSRF
  httpAgent: safeHttpAgent,
  httpsAgent: safeHttpsAgent,
  maxContentLength: 5 * 1024 * 1024, // 5MB
  maxBodyLength: 5 * 1024 * 1024, // 5MB (node-only)
});

export async function safeGetText(url: string, opts: SafeUrlOptions = {}): Promise<string> {
  assertSafeOutboundUrl(url, opts);
  const res = await safeAxios.get(url, {
    responseType: 'text',
    transformResponse: r => r,
  });
  return typeof res.data === 'string' ? res.data : String(res.data);
}

