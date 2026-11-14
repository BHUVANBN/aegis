import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { z } from 'zod';
import { migrate } from './migrate.js';

const Opts = z.object({
  projectKey: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  projectName: z.string().min(1).max(200),
  repoUrl: z.string().max(500).default(''),
  envName: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  envKind: z.enum(['dev', 'staging', 'prod']),
  subscriptionId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
  resourceGroup: z.string().regex(/^[A-Za-z0-9._()-]{1,90}$/),
  adminOid: z.string().min(1).max(200),
});
export type BootstrapOptions = z.infer<typeof Opts>;

/** Creates (or reuses) a project + environment and grants the first administrator access. Idempotent. Parameterised SQL only. */
export async function bootstrap(db: pg.Pool, raw: unknown): Promise<{ environmentId: string }> {
  const o = Opts.parse(raw);
  await migrate(db);
  await db.query(
    `INSERT INTO projects(key,name,repo_url,pipeline_ref) VALUES ($1,$2,$3,'pipelines/workload-deploy.yml') ON CONFLICT (key) DO NOTHING`,
    [o.projectKey, o.projectName, o.repoUrl],
  );
  const env = await db.query<{ id: string }>(
    `INSERT INTO environments(project_id,name,kind,subscription_id,resource_group) SELECT id,$2,$3,$4,$5 FROM projects WHERE key=$1
     ON CONFLICT (project_id,name) DO UPDATE SET subscription_id=EXCLUDED.subscription_id, resource_group=EXCLUDED.resource_group RETURNING id`,
    [o.projectKey, o.envName, o.envKind, o.subscriptionId, o.resourceGroup],
  );
  const id = env.rows[0]!.id;
  for (const role of ['admin', 'viewer'])
    await db.query(
      'INSERT INTO environment_access(environment_id,principal_oid,role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [id, o.adminOid, role],
    );
  return { environmentId: id };
}

/** CLI: tsx apps/api/src/db/bootstrap.ts --project-key demo --project-name Demo --env-name prod --env-kind prod --subscription-id <guid> --resource-group rg-demo-prod --admin-oid <oid> [--repo-url ...] */
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const get = (k: string): string | undefined => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(2);
  }
  const pool = new pg.Pool({
    connectionString: url,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  });
  bootstrap(pool, {
    projectKey: get('project-key'),
    projectName: get('project-name'),
    repoUrl: get('repo-url') ?? '',
    envName: get('env-name'),
    envKind: get('env-kind'),
    subscriptionId: get('subscription-id'),
    resourceGroup: get('resource-group'),
    adminOid: get('admin-oid'),
  })
    .then((r) => console.log('bootstrapped environment', r.environmentId))
    .catch((e) => {
      console.error(
        e instanceof z.ZodError
          ? JSON.stringify(e.issues.map((i) => `${i.path.join('.')}: ${i.message}`))
          : e.message,
      );
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
