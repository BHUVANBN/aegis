import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Donut, HBarList, StackedBars } from '../components/charts';
import {
  DataTable,
  ErrorBox,
  KpiCard,
  Loading,
  Notice,
  PageHeader,
  Section,
  gateBadge,
  levelBadge,
  toneOf,
  useLoad,
} from '../components/ui';
import { estimateValue, loadAssumptions } from '../lib/assumptions';
import { fmtDay, fmtDuration, fmtHours, fmtMoney, fmtNum, fmtPct, pct } from '../lib/format';

/** Business value: measured outcomes first, then clearly labelled estimates built on assumptions the reader controls. */
export default function Overview() {
  const [days, setDays] = useState(30);
  const [samples, setSamples] = useState(false);
  const [assumptions] = useState(loadAssumptions);
  const m = useLoad(() => api.metrics(days, samples), [days, samples]);
  const d = m.data;
  const est = d ? estimateValue(d, assumptions) : null;

  return (
    <>
      <PageHeader
        title="Business value"
        subtitle="What AEGIS is doing for your change process. Measured numbers come straight from the AEGIS database; estimates multiply them by assumptions you can see and change."
        actions={
          <div className="row">
            <label className="inline-label" htmlFor="period">
              Period
            </label>
            <select id="period" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <button type="button" className="secondary" onClick={m.reload}>
              Refresh
            </button>
          </div>
        }
      />
      {m.error ? <ErrorBox error={m.error} /> : null}
      {m.loading && !d && <Loading label="Calculating" />}
      {d && est && (
        <>
          {(d.sampleCount > 0 || samples) && (
            <Notice tone="info" title="Sample data">
              <label className="check">
                <input type="checkbox" checked={samples} onChange={(e) => setSamples(e.target.checked)} />
                Include the {d.sampleCount} sample assessment{d.sampleCount === 1 ? '' : 's'} created from the Assessments page
              </label>{' '}
              They are hidden from these numbers by default so demonstrations do not look like real results.
            </Notice>
          )}

          {d.totals.assessments === 0 ? (
            <Section title="Nothing has been assessed in this period">
              <p>
                Numbers appear as soon as a pipeline submits a change. To see the dashboard filled in right now, open{' '}
                <Link to="/assessments">Assessments</Link> and choose <strong>Generate sample assessments</strong>. To connect a
                real pipeline, follow <Link to="/setup">Setup</Link>.
              </p>
            </Section>
          ) : (
            <>
              <div className="kpis" role="list">
                <KpiCard
                  label="Changes assessed"
                  basis="measured"
                  value={fmtNum(d.totals.assessments)}
                  hint={`${d.totals.completed} completed, ${d.totals.failed} failed`}
                />
                <KpiCard
                  label="Risky changes caught before deployment"
                  basis="measured"
                  value={fmtNum(d.totals.block + d.totals.requireApproval)}
                  hint={`${d.totals.block} blocked, ${d.totals.requireApproval} held for a person`}
                />
                <KpiCard
                  label="Fast lane: allowed with no human step"
                  basis="measured"
                  value={fmtPct(pct(d.totals.allow, d.totals.assessments))}
                  hint={`${d.totals.allow} low-risk changes went straight through`}
                />
                <KpiCard
                  label="Median assessment time"
                  basis="measured"
                  value={fmtDuration(d.durations.assessmentMedianSec)}
                  hint={`90% finished within ${fmtDuration(d.durations.assessmentP90Sec)}`}
                />
                <KpiCard
                  label="Median wait for an approval decision"
                  basis="measured"
                  value={fmtDuration(d.durations.approvalMedianSec)}
                  hint={`${d.approvals.pending} waiting now`}
                />
                <KpiCard
                  label="Deployments verified as expected"
                  basis="measured"
                  value={d.verifications.total === 0 ? '—' : `${d.verifications.passed} of ${d.verifications.total}`}
                  hint={`${d.deployments.succeeded} of ${d.deployments.total} authorized deployments succeeded`}
                />
                <KpiCard
                  label="Out-of-band changes found"
                  basis="measured"
                  value={fmtNum(d.reconciliation.findings)}
                  hint={`across ${d.reconciliation.runs} drift check${d.reconciliation.runs === 1 ? '' : 's'}`}
                />
                <KpiCard
                  label="Reviewer time saved"
                  basis="estimated"
                  value={`${fmtHours(est.hoursSaved)} h`}
                  hint={`about ${fmtMoney(est.moneySaved, assumptions.currency)} at your hourly rate`}
                />
              </div>

              <div className="charts">
                <Section title="Changes assessed per day">
                  <StackedBars
                    title="Changes assessed per day, by outcome"
                    summary={`${d.totals.allow} allowed, ${d.totals.requireApproval} needed approval and ${d.totals.block} blocked over the last ${d.days} days.`}
                    data={d.daily.map((x) => ({
                      label: fmtDay(x.day),
                      values: { allow: x.allow, requireApproval: x.requireApproval, block: x.block },
                    }))}
                    series={[
                      { key: 'allow', label: 'Allowed', pattern: 'solid' },
                      { key: 'requireApproval', label: 'Needed approval', pattern: 'dots' },
                      { key: 'block', label: 'Blocked', pattern: 'hatch' },
                    ]}
                  />
                </Section>
                <Section title="Risk level mix">
                  <Donut
                    title="Assessed changes by risk level"
                    centerValue={String(d.byRisk.reduce((s, r) => s + r.count, 0))}
                    centerLabel="assessed"
                    slices={d.byRisk.map((r) => ({ label: r.level, value: r.count, tone: toneOf(r.level) }))}
                  />
                </Section>
                <Section title="What AEGIS flags most often">
                  <HBarList
                    title="Most frequent findings"
                    empty="No findings recorded in this period."
                    items={d.topRules.map((r) => ({
                      label: (
                        <>
                          {r.title} <code>{r.ruleId}</code>
                        </>
                      ),
                      note: r.prohibited ? 'Prohibited pattern: always blocked in production' : undefined,
                      value: r.count,
                      tone: toneOf(r.severity),
                    }))}
                  />
                </Section>
                <Section title="From assessment to verified deployment">
                  <HBarList
                    title="Change pipeline stages"
                    items={[
                      { label: 'Assessed', value: d.totals.assessments, tone: 'info' },
                      { label: 'Approval requested', value: d.approvals.total, tone: 'warn' },
                      { label: 'Approved (granted or used)', value: d.approvals.approved + d.approvals.consumed, tone: 'ok' },
                      { label: 'Deployment authorized', value: d.deployments.total, tone: 'info' },
                      { label: 'Deployed successfully', value: d.deployments.succeeded, tone: 'ok' },
                      { label: 'Verified as expected', value: d.verifications.passed, tone: 'ok' },
                    ]}
                    max={Math.max(1, d.totals.assessments)}
                  />
                  <p className="muted small">
                    Each bar counts events in the period on its own, so a bar can exceed the one above it when work started earlier is
                    finishing now.
                  </p>
                </Section>
              </div>

              <Section
                title="Estimated value: how the number is built"
                actions={
                  <Link className="button secondary" to="/settings#assumptions">
                    Change assumptions
                  </Link>
                }
              >
                <Notice tone="warn" title="This is an estimate, not a measurement">
                  Reviewer time saved = for every assessed change, the minutes a person would have spent reviewing it by hand, minus
                  the minutes they still spend with AEGIS. The minutes below are placeholders. Replace them with figures from your own
                  team, ideally measured in a pilot before you quote them.
                </Notice>
                <DataTable
                  caption="Estimated reviewer time saved by risk level and outcome"
                  rows={est.rows.map((r) => ({ id: `${r.level}-${r.decision}`, ...r })) as never}
                  columns={[
                    { key: 'level', label: 'Risk', render: (v) => levelBadge(String(v)) },
                    { key: 'decision', label: 'Outcome', render: (v) => gateBadge(String(v)) },
                    { key: 'count', label: 'Changes' },
                    { key: 'manualMin', label: 'Minutes by hand each' },
                    { key: 'assistedMin', label: 'Minutes with AEGIS each' },
                    { key: 'savedHours', label: 'Hours saved', render: (v) => fmtHours(Number(v)) },
                  ]}
                />
                <p>
                  <strong>
                    Total: {fmtHours(est.hoursSaved)} reviewer hours, about {fmtMoney(est.moneySaved, assumptions.currency)}
                  </strong>{' '}
                  at {fmtMoney(assumptions.hourlyRate, assumptions.currency)} per hour, across {est.changesCounted} assessed changes.
                </p>
                {assumptions.incidentCost > 0 && (
                  <p>
                    Optional: {d.totals.block} blocked change{d.totals.block === 1 ? '' : 's'} × your assumed incident cost of{' '}
                    {fmtMoney(assumptions.incidentCost, assumptions.currency)} ={' '}
                    <strong>{fmtMoney(est.incidentAvoided, assumptions.currency)}</strong> of potential cost avoided. A blocked change
                    is not proof that an incident would have happened.
                  </p>
                )}
              </Section>

              <Section title="By environment">
                <DataTable
                  caption="Assessments and deployments by environment"
                  rows={d.byEnvironment.map((e) => ({ id: `${e.project}/${e.environment}`, ...e })) as never}
                  columns={[
                    { key: 'environment', label: 'Environment', render: (_v, r) => `${String(r.project)} / ${String(r.environment)}` },
                    { key: 'kind', label: 'Kind' },
                    { key: 'assessments', label: 'Assessed' },
                    { key: 'blocked', label: 'Blocked' },
                    { key: 'needsApproval', label: 'Needed approval' },
                    { key: 'deployments', label: 'Deployments' },
                    { key: 'deploymentsSucceeded', label: 'Succeeded' },
                  ]}
                />
              </Section>

              <Section title="Reading these numbers">
                <ul className="plain">
                  <li>
                    In the last {d.days} days AEGIS assessed <strong>{d.totals.assessments}</strong> change
                    {d.totals.assessments === 1 ? '' : 's'}. <strong>{fmtPct(pct(d.totals.allow, d.totals.assessments))}</strong> went
                    through the fast lane with no person involved.
                  </li>
                  {d.totals.block > 0 && (
                    <li>
                      <strong>{d.totals.block}</strong> change{d.totals.block === 1 ? ' was' : 's were'} blocked before reaching Azure.
                      The most common reason is shown under "What AEGIS flags most often".
                    </li>
                  )}
                  {d.approvals.pending > 0 && (
                    <li>
                      <strong>{d.approvals.pending}</strong> approval{d.approvals.pending === 1 ? ' is' : 's are'} waiting
                      {d.approvals.oldestPendingSec !== null ? `; the oldest for ${fmtDuration(d.approvals.oldestPendingSec)}` : ''}.{' '}
                      <Link to="/approvals">Review them</Link>.
                    </li>
                  )}
                  <li>
                    These figures only cover changes submitted to AEGIS. A deployment that bypasses the pipeline is not counted here; the{' '}
                    <Link to="/reconcile">drift checks</Link> look for those.
                  </li>
                </ul>
                <p className="muted small">Calculated {new Date(d.generatedAt).toLocaleString()}.</p>
              </Section>
            </>
          )}
        </>
      )}
    </>
  );
}
