import type { NextFunction, Request, Response } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { ROLES, type Role } from '@aegis/shared';
import type { Config } from './config.js';
import type { Db } from './db/db.js';
import { AppError } from './util.js';

export interface Principal {
  oid: string;
  name?: string;
  email?: string;
  roles: Role[];
}
declare module 'express-serve-static-core' {
  interface Request {
    principal?: Principal;
  }
}

const asRoles = (v: unknown): Role[] =>
  (Array.isArray(v) ? v : []).filter((r): r is Role => (ROLES as readonly string[]).includes(r));

export function authenticate(cfg: Config, db: Db) {
  const jwks =
    cfg.AUTH_MODE === 'entra'
      ? createRemoteJWKSet(
          new URL(`https://login.microsoftonline.com/${cfg.ENTRA_TENANT_ID}/discovery/v2.0/keys`),
        )
      : null;
  const audience = cfg.ENTRA_API_AUDIENCE
    ? [cfg.ENTRA_API_AUDIENCE, cfg.ENTRA_API_AUDIENCE.replace(/^api:\/\//, '')]
    : [];
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const h = req.header('authorization') ?? '';
      const m = /^Bearer (.+)$/.exec(h);
      if (!m) throw new AppError(401, 'unauthenticated', 'Missing bearer token');
      const token = m[1]!;
      let p: Principal;
      if (cfg.AUTH_MODE === 'dev') {
        const parts = token.split(':');
        if (parts[0] !== 'dev' || !parts[1]) throw new AppError(401, 'unauthenticated', 'Invalid dev token');
        p = { oid: parts[1], email: parts[1], name: parts[1], roles: asRoles((parts[2] ?? '').split(',')) };
      } else {
        const { payload } = await jwtVerify(token, jwks!, {
          issuer: `https://login.microsoftonline.com/${cfg.ENTRA_TENANT_ID}/v2.0`,
          audience,
          algorithms: ['RS256'],
        });
        if (typeof payload.oid !== 'string')
          throw new AppError(401, 'unauthenticated', 'Token has no oid claim');
        if (payload.tid !== cfg.ENTRA_TENANT_ID) throw new AppError(401, 'unauthenticated', 'Wrong tenant');
        p = {
          oid: payload.oid,
          name: typeof payload.name === 'string' ? payload.name : undefined,
          email: typeof payload.preferred_username === 'string' ? payload.preferred_username : undefined,
          roles: asRoles(payload.roles),
        };
      }
      req.principal = p;
      await db.query(
        `INSERT INTO principals(oid,display_name,email) VALUES ($1,$2,$3) ON CONFLICT (oid) DO UPDATE SET last_seen_at=now(), display_name=COALESCE(EXCLUDED.display_name, principals.display_name)`,
        [p.oid, p.name ?? null, p.email ?? null],
      );
      next();
    } catch (e) {
      next(e instanceof AppError ? e : new AppError(401, 'unauthenticated', 'Invalid or expired token'));
    }
  };
}

/** Effective roles in an environment = roles in the token INTERSECT roles granted in the database for that environment. */
export async function effectiveRoles(db: Db, p: Principal, environmentId: string): Promise<Role[]> {
  const r = await db.query<{ role: Role }>(
    'SELECT role FROM environment_access WHERE environment_id=$1 AND principal_oid=$2',
    [environmentId, p.oid],
  );
  const granted = new Set(r.rows.map((x) => x.role));
  return p.roles.filter((role) => granted.has(role));
}

export async function requireEnvRole(
  db: Db,
  p: Principal,
  environmentId: string,
  allowed: Role[],
): Promise<Role[]> {
  const eff = await effectiveRoles(db, p, environmentId);
  // admin may do everything except operations reserved to the pipeline identity alone (authorize, report result)
  const pipelineOnly = allowed.length === 1 && allowed[0] === 'pipeline';
  if (!eff.some((r) => allowed.includes(r) || (r === 'admin' && !pipelineOnly)))
    throw new AppError(403, 'forbidden', 'Insufficient permissions for this environment');
  return eff;
}

export function requireTokenRole(...allowed: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.principal?.roles.some((r) => allowed.includes(r)))
      return next(new AppError(403, 'forbidden', 'Insufficient permissions'));
    next();
  };
}
