import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ping } from '../api';
import {
  Badge,
  DataTable,
  ErrorBox,
  KpiCard,
  Loading,
  Notice,
  PageHeader,
  Section,
  useLoad,
  type Tone,
} from '../components/ui';
import { actionLabel, fmtAge, fmtDuration, fmtPct, pct } from '../lib/format';

interface Attention {
  tone: Tone;
  text: string;
  link?: { to: string; label: string };
}

/** Monitoring: is AEGIS itself healthy, and does anything need a human today? */
export default function Operations() {
  const [auto, setAuto] = useState(true);
  const [tick, setTick] = useState(0);
  const [updated, setUpdated] = useState<Date | null>(null);
  const sys = useLoad(() => api.system(), [tick]);
  const probe = useLoad(async () => {
    const [h, r] = await Promise.all([ping('/healthz'), ping('/readyz')]);
    return { h, r };
  }, [tick]);
  useEffect(() => {
    if (sys.data) setUpdated(new Date());
  }, [sys.data]);
  useEffect(() => {
    if (!auto) return;
    const t = window.setInterval(() => setTick((x) => x + 1), 30_000);
    return () => window.clearInterval(t);
  }, [auto]);

  const s = sys.data;
  const p = probe.data;
  const items: Attention[] = [];
  if (p && !p.h.ok) items.push({ tone: 'bad', text: 'The API did not answer its health check.' });
  if (p && p.h.ok && !p.r.ok) items.push({ tone: 'bad', text: 'The API is running but reports it is not ready (database unreachable).' });
  if (s) {
    if (!s.audit.ok)
      items.push({
        tone: 'bad',
        text: `The audit log hash chain is broken at event #${s.audit.brokenAtId ?? '?'}. Treat the history as possibly altered.`,
        link: { to: '/audit', label: 'Open the audit trail' },
      });
    if (s.authMode !== 'entra')
      items.push({ tone: 'bad', text: `Sign-in mode is "${s.authMode}". Only Microsoft Entra sign-in is safe outside development.` });
    if (s.stuckAssessments.length > 0)
      items.push({
        tone: 'warn',
        text: `${s.stuckAssessments.length} assessment${s.stuckAssessments.length === 1 ? ' has' : 's have'} been pending for over 10 minutes. The longest has waited ${fmtDuration(s.stuckAssessments[0]!.ageSec)}.`,
        link: { to: `/assessments/${s.stuckAssessments[0]!.id}`, label: 'Open the oldest' },
      });
    if (s.failedAssessments24h > 0)
      items.push({
        tone: 'warn',
        text: `${s.failedAssessments24h} assessment${s.failedAssessments24h === 1 ? '' : 's'} failed in the last 24 hours.`,
        link: { to: '/assessments', label: 'See assessments' },
      });
    const bad = s.agentStats.filter((a) => a.failures > 0);
    if (bad.length > 0)
      items.push({ tone: 'warn', text: `Agent failures in the last 7 days: ${bad.map((a) => `${a.agent} (${a.failures})`).join(', ')}.` });
    if (s.pendingApprovals.count > 0)
      items.push({
        tone: (s.pendingApprovals.oldestSec ?? 0) > 86_400 ? 'warn' : 'info',
        text: `${s.pendingApprovals.count} approval request${s.pendingApprovals.count === 1 ? ' is' : 's are'} waiting${
          s.pendingApprovals.oldestSec !== null ? `; the oldest for ${fmtDuration(s.pendingApprovals.oldestSec)}` : ''
        }.`,
        link: { to: '/approvals', label: 'Review approvals' },
      });
    if (s.expiredDeployments > 0)
      items.push({
        tone: 'warn',
        text: `${s.expiredDeployments} authorized deployment${s.expiredDeployments === 1 ? '' : 's'} never reported a result and the lock expired.`,
      });
    if (!s.resourceGraph)
      items.push({
        tone: 'warn',
        text: 'Azure Resource Graph is not connected, so dependency, verification and drift checks cannot query Azure.',
      });
    if (!s.lastReconcile)
      items.push({ tone: 'info', text: 'No drift check has run yet.', link: { to: '/reconcile', label: 'Run one' } });
    else if (s.lastReconcile.findings > 0)
      items.push({
        tone: 'warn',
        text: `The last drift check found ${s.lastReconcile.findings} suspected out-of-band change${s.lastReconcile.findings === 1 ? '' : 's'}.`,
        link: { to: '/reconcile', label: 'Review drift' },
      });
    else if (Date.now() - new Date(s.lastReconcile.at).getTime() > 172_800_000)
      items.push({ tone: 'info', text: `The last drift check was ${fmtAge(s.lastReconcile.at)}.`, link: { to: '/reconcile', label: 'Run one' } });
  }
  const attentionCount = items.filter((i) => i.tone !== 'info').length;

  return (
    <>
      <PageHeader
        title="Operations"
        subtitle="Is AEGIS itself healthy, and does anything need a person today?"
        actions={
          <div className="row">
            <label className="check">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              Refresh every 30 s
            </label>
            <button type="button" className="secondary" onClick={() => setTick((x) => x + 1)}>
              Refresh now
            </button>
          </div>
        }
      />
      <p className="muted small">{updated ? `Last updated ${updated.toLocaleTimeString()}` : 'Checking…'}</p>
      <p className="sr-only" role="status" aria-live="polite">
        {s ? (attentionCount === 0 ? 'Nothing needs attention.' : `${attentionCount} items need attention.`) : ''}
      </p>
      {sys.error ? <ErrorBox error={sys.error} /> : null}
      {sys.loading && !s && <Loading label="Checking the platform" />}

      {s && (
        <>
          <Section title="Needs attention">
            {items.length === 0 ? (
              <Notice tone="ok" title="All clear">
                Nothing needs attention right now.
              </Notice>
            ) : (
              <ul className="attention">
                {items.map((i, n) => (
                  <li key={n}>
                    <Badge kind={i.tone === 'bad' ? 'failed' : i.tone === 'warn' ? 'pending' : 'running'}>
                      {i.tone === 'bad' ? 'Act now' : i.tone === 'warn' ? 'Check' : 'Note'}
                    </Badge>
                    <span>{i.text}</span>
                    {i.link && <Link to={i.link.to}>{i.link.label}</Link>}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <div className="kpis" role="list">
            <KpiCard
              label="API"
              basis="status"
              value={p ? (p.h.ok ? 'Up' : 'Down') : '…'}
              hint={p ? `health check ${p.h.ms} ms` : undefined}
            />
            <KpiCard
              label="Database"
              basis="status"
              value={s.db.ok ? 'Reachable' : 'Down'}
              hint={`query took ${s.db.latencyMs} ms`}
            />
            <KpiCard
              label="Azure Resource Graph"
              basis="status"
              value={s.resourceGraph ? 'Connected' : 'Not connected'}
              hint="needed for dependencies, verification, drift"
            />
            <KpiCard
              label="Audit log integrity"
              basis="status"
              value={s.audit.ok ? 'Intact' : 'Broken'}
              hint={`${s.audit.checked} events checked`}
            />
            <KpiCard label="Sign-in mode" basis="status" value={s.authMode === 'entra' ? 'Entra ID' : s.authMode} />
            <KpiCard
              label="Advisory model"
              basis="status"
              value={s.llm === 'none' ? 'None' : s.llm}
              hint={s.llm === 'none' ? 'decisions use rules only' : 'explains, never decides'}
            />
            <KpiCard label="Rules version" basis="status" value={s.rulesVersion ?? '—'} />
            <KpiCard label="API uptime" basis="status" value={fmtDuration(s.uptimeSec)} hint="since last start (it scales to zero)" />
          </div>

          <Section title="Agent reliability (last 7 days)">
            <DataTable
              caption="Agent runs"
              rows={s.agentStats.map((a) => ({ id: a.agent, ...a })) as never}
              columns={[
                { key: 'agent', label: 'Agent' },
                { key: 'runs', label: 'Runs' },
                { key: 'failures', label: 'Failures' },
                { key: 'rate', label: 'Success rate', render: (_v, r) => fmtPct(pct(Number(r.runs) - Number(r.failures), Number(r.runs))) },
                { key: 'medianMs', label: 'Median time', render: (v) => (v === null ? '—' : `${Math.round(Number(v))} ms`) },
              ]}
            />
          </Section>

          {s.recentActivity && (
            <Section title="Recent activity">
              <DataTable
                caption="Latest audit events"
                rows={s.recentActivity as never}
                columns={[
                  { key: 'at', label: 'When', render: (v) => fmtAge(String(v)) },
                  { key: 'action', label: 'What happened', render: (v) => actionLabel(String(v)) },
                  { key: 'actor', label: 'Who', render: (v) => String(v).slice(0, 8) },
                  { key: 'environment', label: 'Environment' },
                ]}
              />
              <p>
                <Link to="/audit">Open the full audit trail</Link>
              </p>
            </Section>
          )}

          <Section title="Deeper monitoring in Azure">
            <p>
              Logs and application telemetry are collected in Log Analytics and Application Insights. These links open the Azure portal
              in a new tab, where you can build alerts and queries.
            </p>
            <ul className="plain">
              <li>
                <a href="https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.Insights%2Fcomponents" target="_blank" rel="noreferrer">
                  Application Insights (opens in a new tab)
                </a>
              </li>
              <li>
                <a href="https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.OperationalInsights%2Fworkspaces" target="_blank" rel="noreferrer">
                  Log Analytics workspaces (opens in a new tab)
                </a>
              </li>
              <li>
                <a href="https://portal.azure.com/#view/Microsoft_Azure_CostManagement/Menu/~/overview" target="_blank" rel="noreferrer">
                  Cost Management (opens in a new tab)
                </a>
              </li>
            </ul>
          </Section>
        </>
      )}
    </>
  );
}
