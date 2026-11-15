import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { API_BASE, api, type AdminProject, type Principal } from '../api';
import { API_AUDIENCE, useAuth } from '../auth';
import {
  Badge,
  CopyButton,
  DataTable,
  Dialog,
  ErrorBox,
  Field,
  Loading,
  Notice,
  PageHeader,
  Section,
  Tabs,
  describedBy,
  tabPanelProps,
  useLoad,
} from '../components/ui';
import { fmtDate } from '../lib/format';

type TabId = 'start' | 'projects' | 'access' | 'connect';
const KEY_RE = /^[a-z0-9][a-z0-9-]*$/;
const ROLE_HELP: Record<string, string> = {
  viewer: 'Can read assessments and metrics',
  assessor: 'Can submit assessments and request approvals',
  approver: 'Can approve or reject requests, never their own',
  admin: 'Can manage access and read the audit trail',
  pipeline: 'For pipeline identities only: authorizes deployments',
};

export default function Setup() {
  const { me } = useAuth();
  if (!me) return null;
  if (!me.tokenRoles.includes('admin')) {
    return (
      <>
        <PageHeader title="Setup" subtitle="Projects, environments and who can do what." />
        <Notice tone="info" title="Setup is for administrators">
          Ask an administrator to give you access, and send them the details below. They can add you without using a command line.
        </Notice>
        <Section title="Your details">
          <dl className="details">
            <dt>Name</dt>
            <dd>{me.name ?? '—'}</dd>
            <dt>Email</dt>
            <dd>{me.email ?? '—'}</dd>
            <dt>Object ID</dt>
            <dd>
              <code>{me.oid}</code> <CopyButton text={me.oid} label="Copy ID" />
            </dd>
          </dl>
        </Section>
      </>
    );
  }
  return <AdminSetup />;
}

function AdminSetup() {
  const [tab, setTab] = useState<TabId>('start');
  const [accessEnv, setAccessEnv] = useState('');
  const projects = useLoad(() => api.adminProjects(), []);
  const principals = useLoad(() => api.principals(), []);
  const assessed = useLoad(() => api.assessments({ limit: 1, offset: 0 }), []);
  const list = projects.data?.items ?? [];
  const envCount = list.reduce((n, p) => n + p.environments.length, 0);
  const shared = list.some((p) => p.environments.some((e) => e.grants >= 2));

  const steps: { done: boolean; title: string; body: string; tab?: TabId }[] = [
    { done: true, title: 'Sign in', body: 'You are signed in as an administrator.' },
    { done: list.length > 0, title: 'Create a project', body: 'A project is one application or team whose infrastructure changes AEGIS will judge.', tab: 'projects' },
    { done: envCount > 0, title: 'Add its environments', body: 'Usually dev and prod. Production is judged more strictly than development.', tab: 'projects' },
    { done: shared, title: 'Give teammates access', body: 'Assessors submit, approvers decide. Add people after they have signed in once.', tab: 'access' },
    { done: (assessed.data?.total ?? 0) > 0, title: 'Connect a pipeline', body: 'Copy the generated pipeline file into your application repository.', tab: 'connect' },
  ];

  return (
    <>
      <PageHeader title="Setup" subtitle="Register projects, give people access and connect pipelines. Everything here works from the browser." />
      {projects.error ? <ErrorBox error={projects.error} /> : null}
      <Tabs
        label="Setup sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'start', label: 'Get started' },
          { id: 'projects', label: 'Projects and environments' },
          { id: 'access', label: 'Access' },
          { id: 'connect', label: 'Connect a pipeline' },
        ]}
      />
      <div {...tabPanelProps(tab)}>
        {projects.loading && !projects.data && <Loading />}
        {tab === 'start' && (
          <Section title="Checklist">
            <ol className="checklist">
              {steps.map((s) => (
                <li key={s.title}>
                  <Badge kind={s.done ? 'complete' : 'pending'}>{s.done ? 'Done' : 'To do'}</Badge>
                  <div>
                    <strong>{s.title}</strong>
                    <p className="muted">{s.body}</p>
                    {!s.done && s.tab && (
                      <button type="button" className="secondary" onClick={() => setTab(s.tab!)}>
                        Go to this step
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ol>
            <p>
              When a pipeline is connected, results appear under <Link to="/overview">Business value</Link> and{' '}
              <Link to="/operations">Operations</Link>. To see them filled in first, use <em>Generate sample assessments</em> on the{' '}
              <Link to="/assessments">Assessments</Link> page.
            </p>
          </Section>
        )}
        {tab === 'projects' && (
          <ProjectsPanel
            projects={list}
            onChanged={projects.reload}
            onManage={(id) => {
              setAccessEnv(id);
              setTab('access');
            }}
          />
        )}
        {tab === 'access' && <AccessPanel projects={list} people={principals.data?.items ?? []} envId={accessEnv} setEnvId={setAccessEnv} />}
        {tab === 'connect' && <ConnectPanel projects={list} />}
      </div>
    </>
  );
}

function ProjectsPanel({ projects, onChanged, onManage }: { projects: AdminProject[]; onChanged: () => void; onManage: (envId: string) => void }) {
  return (
    <>
      {projects.length === 0 && <Notice tone="info">No projects yet. Create the first one below.</Notice>}
      {projects.map((p) => (
        <Section key={p.id} title={`${p.name} (${p.key})`}>
          {p.repo_url && <p className="muted small">{p.repo_url}</p>}
          <DataTable
            caption={`Environments of ${p.name}`}
            rows={p.environments as never}
            columns={[
              { key: 'name', label: 'Environment' },
              { key: 'kind', label: 'Kind' },
              { key: 'resource_group', label: 'Resource group', render: (v) => (v ? String(v) : '—') },
              { key: 'subscription_id', label: 'Subscription', render: (v) => (v ? <code>{String(v).slice(0, 8)}…</code> : '—') },
              { key: 'grants', label: 'People with access' },
              {
                key: 'id',
                label: 'Manage',
                render: (v, r) => (
                  <button type="button" className="secondary" onClick={() => onManage(String(v))} aria-label={`Manage access to ${String(r.name)} in ${p.name}`}>
                    Manage access
                  </button>
                ),
              },
            ]}
          />
        </Section>
      ))}
      <div className="two-col">
        <ProjectForm onCreated={onChanged} />
        <EnvironmentForm projects={projects} onCreated={onChanged} />
      </div>
    </>
  );
}

function ProjectForm({ onCreated }: { onCreated: () => void }) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [repo, setRepo] = useState('');
  const [errs, setErrs] = useState<{ key?: string; name?: string; form?: string }>({});
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const next: typeof errs = {};
    if (!KEY_RE.test(key)) next.key = 'Use lowercase letters, digits and dashes, starting with a letter or digit.';
    if (!name.trim()) next.name = 'Give the project a name.';
    setErrs(next);
    setOk(null);
    if (next.key || next.name) return;
    setBusy(true);
    try {
      await api.createProject({ key, name: name.trim(), repoUrl: repo.trim() || undefined });
      setOk(`Project "${name.trim()}" created. Now add its environments.`);
      setKey('');
      setName('');
      setRepo('');
      onCreated();
    } catch (e2) {
      setErrs({ form: (e2 as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Add a project">
      <form onSubmit={(e) => void submit(e)} noValidate>
        <Field id="p-key" label="Key" hint="Short and permanent. Pipelines refer to it, for example payments." error={errs.key}>
          <input id="p-key" value={key} onChange={(e) => setKey(e.target.value.toLowerCase())} maxLength={60} aria-invalid={errs.key ? true : undefined} aria-describedby={describedBy('p-key', true, !!errs.key)} />
        </Field>
        <Field id="p-name" label="Name" error={errs.name}>
          <input id="p-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} aria-invalid={errs.name ? true : undefined} aria-describedby={describedBy('p-name', false, !!errs.name)} />
        </Field>
        <Field id="p-repo" label="Repository address (optional)" hint="Shown for reference only.">
          <input id="p-repo" type="url" value={repo} onChange={(e) => setRepo(e.target.value)} maxLength={300} aria-describedby={describedBy('p-repo', true, false)} />
        </Field>
        {errs.form && <Notice tone="error">{errs.form}</Notice>}
        <div role="status">{ok && <Notice tone="ok">{ok}</Notice>}</div>
        <button type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create project'}
        </button>
      </form>
    </Section>
  );
}

function EnvironmentForm({ projects, onCreated }: { projects: AdminProject[]; onCreated: () => void }) {
  const [pk, setPk] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'dev' | 'staging' | 'prod'>('dev');
  const [sub, setSub] = useState('');
  const [rg, setRg] = useState('');
  const [errs, setErrs] = useState<{ pk?: string; name?: string; sub?: string; form?: string }>({});
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const next: typeof errs = {};
    if (!pk) next.pk = 'Choose a project.';
    if (!KEY_RE.test(name)) next.name = 'Use lowercase letters, digits and dashes, for example prod.';
    if (sub && !/^[0-9a-fA-F-]{36}$/.test(sub)) next.sub = 'A subscription ID looks like 00000000-0000-0000-0000-000000000000.';
    setErrs(next);
    setOk(null);
    if (next.pk || next.name || next.sub) return;
    setBusy(true);
    try {
      await api.createEnvironment({ projectKey: pk, name, kind, subscriptionId: sub.trim() || undefined, resourceGroup: rg.trim() || undefined });
      setOk(`Environment "${name}" added. You were given admin access to it.`);
      setName('');
      setSub('');
      setRg('');
      onCreated();
    } catch (e2) {
      setErrs({ form: (e2 as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Add an environment">
      <form onSubmit={(e) => void submit(e)} noValidate>
        <Field id="e-proj" label="Project" error={errs.pk}>
          <select id="e-proj" value={pk} onChange={(e) => setPk(e.target.value)} aria-invalid={errs.pk ? true : undefined} aria-describedby={describedBy('e-proj', false, !!errs.pk)}>
            <option value="">Choose…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="e-name" label="Name" hint="For example dev or prod." error={errs.name}>
          <input id="e-name" value={name} onChange={(e) => setName(e.target.value.toLowerCase())} maxLength={60} aria-invalid={errs.name ? true : undefined} aria-describedby={describedBy('e-name', true, !!errs.name)} />
        </Field>
        <Field id="e-kind" label="Kind" hint="Production is judged more strictly than development.">
          <select id="e-kind" value={kind} onChange={(e) => setKind(e.target.value as 'dev' | 'staging' | 'prod')} aria-describedby={describedBy('e-kind', true, false)}>
            <option value="dev">Development</option>
            <option value="staging">Staging</option>
            <option value="prod">Production</option>
          </select>
        </Field>
        <Field id="e-rg" label="Azure resource group (optional)" hint="Used by verification and drift checks.">
          <input id="e-rg" value={rg} onChange={(e) => setRg(e.target.value)} maxLength={90} aria-describedby={describedBy('e-rg', true, false)} />
        </Field>
        <Field id="e-sub" label="Azure subscription ID (optional)" error={errs.sub}>
          <input id="e-sub" value={sub} onChange={(e) => setSub(e.target.value)} maxLength={36} aria-invalid={errs.sub ? true : undefined} aria-describedby={describedBy('e-sub', false, !!errs.sub)} />
        </Field>
        {errs.form && <Notice tone="error">{errs.form}</Notice>}
        <div role="status">{ok && <Notice tone="ok">{ok}</Notice>}</div>
        <button type="submit" disabled={busy || projects.length === 0}>
          {busy ? 'Adding…' : 'Add environment'}
        </button>
      </form>
    </Section>
  );
}

function AccessPanel({ projects, people, envId, setEnvId }: { projects: AdminProject[]; people: Principal[]; envId: string; setEnvId: (v: string) => void }) {
  const envs = projects.flatMap((p) => p.environments.map((e) => ({ ...e, label: `${p.key} / ${e.name}` })));
  const grants = useLoad(() => (envId ? api.envAccess(envId) : Promise.resolve({ items: [] })), [envId]);
  const [who, setWho] = useState('');
  const [manual, setManual] = useState('');
  const [role, setRole] = useState('viewer');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [remove, setRemove] = useState<{ oid: string; role: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const target = who === '__manual' ? manual.trim() : who;
  const envLabel = envs.find((e) => e.id === envId)?.label ?? '';

  const add = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setOk(null);
    if (!target) {
      setErr('Choose a person, or enter their object ID.');
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await api.grantAccess(envId, target, role);
      setOk(`Granted ${role} on ${envLabel}.`);
      grants.reload();
    } catch (e2) {
      setErr((e2 as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const confirmRemove = async () => {
    if (!remove) return;
    setBusy(true);
    try {
      await api.revokeAccess(envId, remove.oid, remove.role);
      setOk(`Removed ${remove.role} from ${remove.name}.`);
      setRemove(null);
      grants.reload();
    } catch (e2) {
      setErr((e2 as Error).message);
      setRemove(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Notice tone="info" title="Two things control access">
        <strong>Environment access</strong> (this page) says who may act on each environment. The sign-in token must also carry an app role, which is
        assigned in Microsoft Entra: open <em>Enterprise applications</em>, choose <em>aegis-api</em>, then <em>Users and groups</em>.{' '}
        <a href="https://portal.azure.com/#view/Microsoft_AAD_IAM/StartboardApplicationsMenuBlade/~/AppAppsPreview" target="_blank" rel="noreferrer">
          Open Enterprise applications (new tab)
        </a>
        . A person needs both.
      </Notice>
      <Field id="acc-env" label="Environment">
        <select id="acc-env" value={envId} onChange={(e) => setEnvId(e.target.value)}>
          <option value="">Choose an environment…</option>
          {envs.map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </select>
      </Field>
      {envId && (
        <>
          {grants.loading && !grants.data && <Loading />}
          {grants.error ? <ErrorBox error={grants.error} /> : null}
          {grants.data && (
            <Section title={`Who has access to ${envLabel}`}>
              <DataTable
                caption={`Access to ${envLabel}`}
                rows={grants.data.items.map((g) => ({ id: `${g.principal_oid}-${g.role}`, ...g })) as never}
                columns={[
                  { key: 'display_name', label: 'Person', render: (v, r) => (v ? String(v) : `Unknown (${String(r.principal_oid).slice(0, 8)})`) },
                  { key: 'email', label: 'Email', render: (v) => (v ? String(v) : '—') },
                  { key: 'role', label: 'Role', render: (v) => <span className="chip" title={ROLE_HELP[String(v)]}>{String(v)}</span> },
                  { key: 'created_at', label: 'Since', render: (v) => fmtDate(String(v)) },
                  {
                    key: 'principal_oid',
                    label: 'Remove',
                    render: (v, r) => (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setRemove({ oid: String(v), role: String(r.role), name: String(r.display_name ?? String(v).slice(0, 8)) })}
                        aria-label={`Remove ${String(r.role)} from ${String(r.display_name ?? v)}`}
                      >
                        Remove
                      </button>
                    ),
                  },
                ]}
              />
            </Section>
          )}
          <Section title="Grant access">
            <form onSubmit={(e) => void add(e)} noValidate>
              <Field id="g-who" label="Person" hint="People appear here after they have signed in to AEGIS once.">
                <select id="g-who" value={who} onChange={(e) => setWho(e.target.value)} aria-describedby={describedBy('g-who', true, false)}>
                  <option value="">Choose…</option>
                  {people.map((p) => (
                    <option key={p.oid} value={p.oid}>
                      {p.display_name ?? p.email ?? p.oid}
                      {p.email && p.display_name ? ` (${p.email})` : ''}
                    </option>
                  ))}
                  <option value="__manual">Someone else: enter an object ID…</option>
                </select>
              </Field>
              {who === '__manual' && (
                <Field id="g-oid" label="Object ID" hint="From Microsoft Entra: Users, then the person, then Object ID. For a pipeline, the service principal's object ID.">
                  <input id="g-oid" value={manual} onChange={(e) => setManual(e.target.value)} maxLength={200} aria-describedby={describedBy('g-oid', true, false)} />
                </Field>
              )}
              <Field id="g-role" label="Role" hint={ROLE_HELP[role]}>
                <select id="g-role" value={role} onChange={(e) => setRole(e.target.value)} aria-describedby={describedBy('g-role', true, false)}>
                  {Object.keys(ROLE_HELP).map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </Field>
              {err && <Notice tone="error">{err}</Notice>}
              <div role="status">{ok && <Notice tone="ok">{ok}</Notice>}</div>
              <button type="submit" disabled={busy}>
                Grant access
              </button>
            </form>
          </Section>
        </>
      )}
      {remove && (
        <Dialog
          title="Remove access?"
          onClose={() => setRemove(null)}
          footer={
            <>
              <button type="button" className="secondary" onClick={() => setRemove(null)}>
                Cancel
              </button>
              <button type="button" className="danger" disabled={busy} onClick={() => void confirmRemove()}>
                Remove
              </button>
            </>
          }
        >
          <p>
            Remove the <strong>{remove.role}</strong> role from <strong>{remove.name}</strong> on {envLabel}? They lose this access immediately.
          </p>
        </Dialog>
      )}
    </>
  );
}

function ConnectPanel({ projects }: { projects: AdminProject[] }) {
  const [key, setKey] = useState('');
  const [ado, setAdo] = useState('aegis');
  const [tpl, setTpl] = useState('infra/main.bicep');
  const [rg, setRg] = useState('');
  const pk = key || projects[0]?.key || 'my-project';
  const P = '${{ parameters.targetEnvironment }}';
  const yaml = [
    'trigger:',
    '  branches: { include: [main] }',
    '  paths: { include: [infra/*] }',
    'pool: { name: Default }          # your agent pool',
    'parameters:',
    '  - name: targetEnvironment',
    '    type: string',
    '    default: dev',
    '    values: [dev, prod]',
    'resources:',
    '  repositories:',
    '    - repository: aegisTemplates',
    '      type: git',
    `      name: ${ado}/aegis-pipeline-templates`,
    '      ref: refs/heads/main',
    'extends:',
    '  template: governed-pipeline.yml@aegisTemplates',
    '  parameters:',
    `    targetEnvironment: ${P}`,
    `    projectKey: ${pk}`,
    `    templateSource: ${tpl}`,
    `    resourceGroup: ${rg || `rg-${pk}`}-${P}`,
    `    deployParameters: environmentName=${P}`,
    `    serviceConnection: aegis-${P}-sc`,
    '',
  ].join('\n');
  return (
    <>
      <Notice tone="info">
        The governance logic lives in a shared, protected template. Your application repository only needs this small file. It matches
        pipelines/workload-deploy.yml in the AEGIS repository.
      </Notice>
      <div className="two-col">
        <Section title="1. Describe your application">
          <Field id="c-proj" label="AEGIS project">
            <select id="c-proj" value={key} onChange={(e) => setKey(e.target.value)}>
              {projects.length === 0 && <option value="">Create a project first</option>}
              {projects.map((p) => (
                <option key={p.id} value={p.key}>
                  {p.name} ({p.key})
                </option>
              ))}
            </select>
          </Field>
          <Field id="c-ado" label="Azure DevOps project name">
            <input id="c-ado" value={ado} onChange={(e) => setAdo(e.target.value)} maxLength={80} />
          </Field>
          <Field id="c-tpl" label="Path of the main infrastructure file in the repository">
            <input id="c-tpl" value={tpl} onChange={(e) => setTpl(e.target.value)} maxLength={160} />
          </Field>
          <Field id="c-rg" label="Resource group name prefix" hint="The environment name is added: rg-yourapp-dev, rg-yourapp-prod.">
            <input id="c-rg" value={rg} placeholder={`rg-${pk}`} onChange={(e) => setRg(e.target.value)} maxLength={80} aria-describedby={describedBy('c-rg', true, false)} />
          </Field>
        </Section>
        <Section title="2. Copy this pipeline file" actions={<CopyButton text={yaml} label="Copy file" />}>
          <pre className="code" tabIndex={0} aria-label="Generated pipeline file">
            {yaml}
          </pre>
        </Section>
      </div>
      <Section title="3. Finish in Azure DevOps">
        <ol className="steps">
          <li>
            Save it as <code>pipelines/workload-deploy.yml</code> in the application repository, then create a pipeline from it.
          </li>
          <li>
            Add a variable group named <code>aegis-pipeline</code> with these two values:
            <ul className="plain">
              <li>
                <code>AEGIS_API_URL</code> = <code>{API_BASE}</code> <CopyButton text={API_BASE} />
              </li>
              <li>
                <code>AEGIS_API_AUDIENCE</code> = <code>{API_AUDIENCE || 'api://<your-api-app-id>'}</code>{' '}
                {API_AUDIENCE && <CopyButton text={API_AUDIENCE} />}
              </li>
            </ul>
          </li>
          <li>
            Create service connections <code>aegis-dev-sc</code> and <code>aegis-prod-sc</code> (workload identity federation, scoped to the
            resource group of each environment).
          </li>
          <li>
            On the <strong>Access</strong> tab, give each service connection&apos;s identity the <code>pipeline</code> role on its environment
            (enter its object ID).
          </li>
          <li>Run the pipeline. Its first assessment appears under Assessments within a minute.</li>
        </ol>
      </Section>
    </>
  );
}
