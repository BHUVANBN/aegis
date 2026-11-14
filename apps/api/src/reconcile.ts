import type { Db } from './db/db.js';
import { withTx } from './db/db.js';
import { audit } from './audit.js';
import type { ResourceGraphClient } from './azure/resourceGraph.js';
import { AppError } from './util.js';

export interface ReconcileFinding {
  resourceId: string;
  resourceType: string;
  changeType: string;
  at: string;
  changedBy: string;
  changedByType: string;
  clientType: string;
  operation: string;
}
export interface ReconcileResult {
  status: 'ok' | 'unavailable';
  reason?: string;
  environment: string;
  sinceHours: number;
  windowsChecked: number;
  changesSeen: number;
  findings: ReconcileFinding[];
  limitations: string[];
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RG_RE = /^[A-Za-z0-9._()-]{1,90}$/;
const GRACE_MS = 10 * 60 * 1000;

/**
 * DETECTIVE control for pipeline bypass. Resource Graph `resourcechanges` lists property changes Azure recorded for the environment's
 * resource group. Any change outside every AEGIS-authorized deployment window (authorization time .. completion + 10 minutes) is reported
 * as a suspected out-of-band change. It cannot PREVENT a bypass and it is noisy by nature (platform and manual operations also change
 * resources); it exists so a bypass cannot stay invisible. Findings are written to the audit trail (summary) and returned.
 */
export async function reconcileEnvironment(
  db: Db,
  arg: ResourceGraphClient | null,
  environmentId: string,
  sinceHours: number,
  actor: string,
): Promise<ReconcileResult> {
  const env = (
    await db.query<{ name: string; subscription_id: string | null; resource_group: string | null }>(
      'SELECT name, subscription_id, resource_group FROM environments WHERE id=$1',
      [environmentId],
    )
  ).rows[0];
  if (!env) throw new AppError(404, 'not_found', 'Environment not found');
  const limitations = [
    'Resource Graph change history covers a limited retention period and may lag; absence of findings is not proof that nothing changed.',
    'Platform-initiated and manual (portal/CLI) changes appear too: review changedBy/clientType before concluding a pipeline was bypassed.',
    'This control detects out-of-band changes after the fact; it does not block them.',
  ];
  const base = {
    environment: env.name,
    sinceHours,
    windowsChecked: 0,
    changesSeen: 0,
    findings: [] as ReconcileFinding[],
    limitations,
  };
  const finish = async (res: ReconcileResult): Promise<ReconcileResult> => {
    await withTx(db, (tx) =>
      audit(tx, {
        actor,
        action: 'reconciliation.run',
        environment: env.name,
        details: {
          status: res.status,
          reason: res.reason,
          sinceHours,
          windowsChecked: res.windowsChecked,
          changesSeen: res.changesSeen,
          findings: res.findings.length,
          sample: res.findings.slice(0, 20),
        },
      }),
    );
    return res;
  };
  if (!arg) return finish({ ...base, status: 'unavailable', reason: 'Resource Graph client not configured' });
  if (
    !env.subscription_id ||
    !GUID_RE.test(env.subscription_id) ||
    !env.resource_group ||
    !RG_RE.test(env.resource_group)
  )
    return finish({
      ...base,
      status: 'unavailable',
      reason: 'Environment has no valid subscription/resource group configured',
    });

  const since = new Date(Date.now() - sinceHours * 3600 * 1000);
  const windows = (
    await db.query<{ a: Date; b: Date | null; l: Date }>(
      `SELECT d.authorized_at AS a, d.completed_at AS b, d.lock_expires_at AS l FROM deployments d JOIN environments e ON e.id=d.environment_id WHERE e.id=$1 AND coalesce(d.completed_at, d.lock_expires_at) >= $2`,
      [environmentId, since],
    )
  ).rows.map((w) => ({ from: w.a.getTime() - 60_000, to: (w.b ?? w.l).getTime() + GRACE_MS }));
  let rows: Record<string, unknown>[];
  try {
    rows = await arg.query(
      `resourcechanges | extend ts = todatetime(properties.changeAttributes.timestamp) | where ts >= datetime(${since.toISOString()}) | where tolower(tostring(properties.targetResourceId)) startswith '/subscriptions/${env.subscription_id.toLowerCase()}/resourcegroups/${env.resource_group.toLowerCase()}/' | project target=tostring(properties.targetResourceId), type=tostring(properties.targetResourceType), changeType=tostring(properties.changeType), ts=tostring(properties.changeAttributes.timestamp), changedBy=tostring(properties.changeAttributes.changedBy), changedByType=tostring(properties.changeAttributes.changedByType), clientType=tostring(properties.changeAttributes.clientType), operation=tostring(properties.changeAttributes.operation) | take 1000`,
      [env.subscription_id],
    );
  } catch (e) {
    return finish({
      ...base,
      status: 'unavailable',
      reason: (e as Error).message.slice(0, 300),
      windowsChecked: windows.length,
    });
  }
  const findings: ReconcileFinding[] = [];
  for (const r of rows) {
    const t = new Date(String(r.ts)).getTime();
    if (Number.isNaN(t) || windows.some((w) => t >= w.from && t <= w.to)) continue;
    findings.push({
      resourceId: String(r.target),
      resourceType: String(r.type),
      changeType: String(r.changeType),
      at: new Date(t).toISOString(),
      changedBy: String(r.changedBy),
      changedByType: String(r.changedByType),
      clientType: String(r.clientType),
      operation: String(r.operation),
    });
  }
  return finish({
    ...base,
    status: 'ok',
    windowsChecked: windows.length,
    changesSeen: rows.length,
    findings,
  });
}
