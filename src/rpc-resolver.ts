// Pick RPC endpoints for whichever chain the wizard selected.
//
// .env only holds one RPC_URL, which is fine when the chain is fixed there. The
// wizard lets you switch chains per run, so an unguarded RPC_URL would happily
// blast an Ethereum tx at a Base node. Resolution order per chain:
//
//   1. RPC_URL_<CHAIN>       — e.g. RPC_URL_BASE, RPC_URL_ETHEREUM (comma-separated ok)
//   2. RPC_URL + EXTRA_RPC_URLS — only when CHAIN in .env matches the selection
//   3. the public endpoints in src/chains.ts
//
// verifyChainId() then confirms the node actually is that chain before we sign.

import { ChainProfile, resolveChain } from "./chains";

export interface ResolvedRpcs {
  urls: string[];
  source: string; // human label describing where these came from
}

function splitList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
}

function dedupe(urls: string[]): string[] {
  return [...new Set(urls)];
}

// Does this URL obviously belong to this chain? Providers encode the network in
// the hostname (base-mainnet.g.alchemy.com), which lets a single RPC_URL be
// matched to the right chain even when CHAIN is unset.
function urlMatchesChain(url: string, profile: ChainProfile): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (profile.rpc.alchemyHost && host === profile.rpc.alchemyHost.toLowerCase()) return true;
  return profile.rpc.public.some((p) => {
    try {
      return new URL(p).hostname.toLowerCase() === host;
    } catch {
      return false;
    }
  });
}

// Private endpoints already configured in .env for this chain, if any.
export function privateRpcsFromEnv(chainKey: string): string[] {
  const profile = resolveChain(chainKey);
  if (!profile) return [];

  // 1. Explicit per-chain entry always wins.
  const perChain = splitList(process.env[`RPC_URL_${chainKey.toUpperCase()}`]);
  if (perChain.length > 0) return perChain;

  const generic = [
    ...splitList(process.env.RPC_URL),
    ...splitList(process.env.EXTRA_RPC_URLS),
  ];

  // 2. CHAIN pins the generic RPC_URL to one network.
  const envChain = (process.env.CHAIN || "").trim().toLowerCase();
  if (envChain === chainKey && generic.length > 0) return generic;

  // 3. CHAIN unset — salvage any generic endpoint whose host names this chain,
  //    so a configured Alchemy key isn't silently ignored.
  const matched = generic.filter((u) => urlMatchesChain(u, profile));
  if (matched.length > 0) return matched;

  return [];
}

// `manual` (entered in the wizard) wins over anything in .env. Public endpoints
// always trail as fallbacks so there is something to blast at either way.
export function resolveRpcsForChain(chainKey: string, manual: string[] = []): ResolvedRpcs {
  const profile = resolveChain(chainKey);
  if (!profile) throw new Error(`Chain không xác định: "${chainKey}"`);

  if (manual.length > 0) {
    return {
      urls: dedupe([...manual, ...profile.rpc.public]),
      source: "RPC vừa nhập + RPC công khai dự phòng",
    };
  }

  const fromEnv = privateRpcsFromEnv(chainKey);
  if (fromEnv.length > 0) {
    return {
      urls: dedupe([...fromEnv, ...profile.rpc.public]),
      source: ".env + RPC công khai dự phòng",
    };
  }

  return {
    urls: dedupe(profile.rpc.public),
    source: "chỉ RPC công khai — có thể quá chậm khi FCFS cạnh tranh",
  };
}

// Accept either a full URL or a bare provider API key, which we expand against
// the chain's Alchemy host. Returns null if it's neither.
export function toRpcUrl(value: string, chainKey: string): string | null {
  const raw = value.trim();
  if (!raw) return null;

  if (raw.includes("://")) {
    try {
      new URL(raw);
      return raw;
    } catch {
      return null;
    }
  }

  // Bare key — only meaningful if we know where to point it.
  const host = resolveChain(chainKey)?.rpc.alchemyHost;
  if (!host) return null;
  if (!/^[A-Za-z0-9_-]{16,}$/.test(raw)) return null;
  return `https://${host}/v2/${raw}`;
}

// Hide the key segment so a shoulder-surf or screenshot doesn't leak it.
export function maskRpc(url: string): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split("/").filter((s) => s.length > 0);
    if (segments.length === 0) return u.origin;
    const last = segments[segments.length - 1];
    segments[segments.length - 1] = last.length > 8 ? `${last.slice(0, 4)}…${last.slice(-4)}` : "…";
    return `${u.origin}/${segments.join("/")}`;
  } catch {
    return url;
  }
}

export interface RpcPlan {
  urls: string[]; // blast list — index 0 is always query-capable when one exists
  verified: boolean; // at least one endpoint confirmed the expected chain id
  dropped: { url: string; chainId: number }[]; // removed: reported another chain
  sendOnly: string[]; // answered nothing, kept for blasting only
  failures: { url: string; message: string }[]; // answered with an error (bad key, quota)
}

// Probe result carrying *why* an endpoint failed, so an exhausted API key shows
// up during setup rather than as a rejected broadcast at fire time.
async function probe(rpcUrl: string, timeoutMs = 8000): Promise<{ chainId: number | null; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: { result?: string; error?: { message?: string } };
    try {
      json = JSON.parse(text);
    } catch {
      return { chainId: null, error: `HTTP ${res.status} (non-JSON response)` };
    }
    if (json.result) return { chainId: parseInt(json.result, 16) };
    if (json.error?.message) return { chainId: null, error: json.error.message };
    return { chainId: null, error: `HTTP ${res.status}` };
  } catch (err: unknown) {
    return { chainId: null, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// Probe every endpoint and put a query-capable one first.
//
// This matters because the whole codebase treats rpcUrls[0] as "the provider"
// for nonces, balances, eth_call and receipts, while blasting to all of them.
// Some endpoints in the public list (Base's sequencer, for one) only accept
// eth_sendRawTransaction — perfect to blast at, useless to read from. Anything
// reporting a different chain is dropped outright rather than blasted at.
export async function planRpcs(urls: string[], expectedChainId: number): Promise<RpcPlan> {
  const probes = await Promise.all(
    urls.map(async (url) => ({ url, ...(await probe(url)) }))
  );

  const matching = probes.filter((p) => p.chainId === expectedChainId).map((p) => p.url);
  const sendOnly = probes.filter((p) => p.chainId === null).map((p) => p.url);
  const dropped = probes
    .filter((p) => p.chainId !== null && p.chainId !== expectedChainId)
    .map((p) => ({ url: p.url, chainId: p.chainId as number }));
  const failures = probes
    .filter((p) => p.chainId === null && p.error)
    .map((p) => ({ url: p.url, message: p.error as string }));

  return {
    urls: [...matching, ...sendOnly],
    verified: matching.length > 0,
    dropped,
    sendOnly,
    failures,
  };
}

// Ask the node what chain it's on. Returns null on any failure — the caller
// decides whether an unreachable RPC is fatal.
export async function verifyChainId(
  rpcUrl: string,
  timeoutMs = 8000
): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "eth_chainId", params: [], id: 1 }),
      signal: controller.signal,
    });
    const json = (await res.json()) as { result?: string };
    if (!json.result) return null;
    return parseInt(json.result, 16);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
