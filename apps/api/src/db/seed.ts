import pg from 'pg';
import { migrate } from './migrate.js';

/** Dev/test seed. Refuses to run in production. */
export async function seed(db: pg.Pool): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed in production');
  await migrate(db);
  const p = await db.query<{ id: string }>(
    `INSERT INTO projects(key,name,repo_url,pipeline_ref) VALUES ('demo','Demo Project','https://dev.azure.com/example/aegis','pipelines/workload-deploy.yml')
     ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
  );
  const projectId = p.rows[0]!.id;
  for (const [name, kind] of [
    ['dev', 'dev'],
    ['prod', 'prod'],
  ] as const) {
    await db.query(
      `INSERT INTO environments(project_id,name,kind,subscription_id,resource_group)
       VALUES ($1,$2,$3,'00000000-0000-0000-0000-000000000000',$4) ON CONFLICT (project_id,name) DO NOTHING`,
      [projectId, name, kind, `rg-demo-${name}`],
    );
  }
  const grants: [string, string][] = [
    ['alice@example.test', 'assessor'],
    ['alice@example.test', 'viewer'],
    ['bob@example.test', 'approver'],
    ['bob@example.test', 'viewer'],
    ['carol@example.test', 'admin'],
    ['carol@example.test', 'viewer'],
    ['pipeline@example.test', 'pipeline'],
  ];
  const envs = await db.query<{ id: string }>('SELECT id FROM environments WHERE project_id=$1', [projectId]);
  for (const e of envs.rows)
    for (const [oid, role] of grants)
      await db.query(
        'INSERT INTO environment_access(environment_id,principal_oid,role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [e.id, oid, role],
      );
}

if (process.argv[1]?.endsWith('seed.ts')) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  seed(pool)
    .then(() => console.log('seeded'))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
