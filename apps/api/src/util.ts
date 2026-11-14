import crypto from 'node:crypto';

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Deterministic JSON (sorted keys) so hashes are stable across processes. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}

/** Reads `a.b[1].c` style paths; object keys match case-insensitively (ARM property names are case-insensitive). */
export function getByPath(root: unknown, path: string): unknown {
  const tokens = path.match(/[^.[\]]+|\[\d+\]/g);
  if (!tokens) return undefined;
  let cur: unknown = root;
  for (const t of tokens) {
    if (cur === null || cur === undefined) return undefined;
    if (t.startsWith('[')) {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[Number(t.slice(1, -1))];
    } else {
      if (typeof cur !== 'object' || Array.isArray(cur)) return undefined;
      const obj = cur as Record<string, unknown>;
      const key = Object.keys(obj).find((k) => k.toLowerCase() === t.toLowerCase());
      cur = key === undefined ? undefined : obj[key];
    }
  }
  return cur;
}

export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

export class TimeoutError extends Error {}

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Azure resource ids are validated to a conservative character set before use in any query string. */
export const SAFE_RESOURCE_ID_RE = /^\/[A-Za-z0-9._\-/()]+$/;
