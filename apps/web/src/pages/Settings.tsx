import { useEffect, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { Field, Notice, PageHeader, Section } from '../components/ui';
import { DEFAULT_ASSUMPTIONS, loadAssumptions, resetAssumptions, saveAssumptions, type Assumptions } from '../lib/assumptions';
import { applyDensity, applyTheme, getDensity, getTheme, type Density, type ThemeChoice } from '../lib/theme';

const THEMES: { id: ThemeChoice; label: string }[] = [
  { id: 'system', label: 'Match my device' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'contrast', label: 'High contrast' },
];

export default function Settings() {
  const [theme, setTheme] = useState<ThemeChoice>(getTheme);
  const [density, setDensity] = useState<Density>(getDensity);
  const [a, setA] = useState<Assumptions>(loadAssumptions);
  const [saved, setSaved] = useState(false);
  const loc = useLocation();
  useEffect(() => {
    if (loc.hash === '#assumptions') document.getElementById('assumptions-heading')?.scrollIntoView();
  }, [loc.hash]);

  const num = (v: string): number => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const save = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    saveAssumptions(a);
    setSaved(true);
  };
  const levels = ['low', 'medium', 'high', 'critical'] as const;
  const decisions: { id: 'allow' | 'require_approval' | 'block'; label: string }[] = [
    { id: 'allow', label: 'Allowed with no human step' },
    { id: 'require_approval', label: 'Held for approval' },
    { id: 'block', label: 'Blocked' },
  ];

  return (
    <>
      <PageHeader title="Settings" subtitle="Appearance, and the assumptions behind the estimated-value numbers. Both are stored only in this browser." />
      <Section title="Appearance">
        <fieldset>
          <legend>Theme</legend>
          <div className="radio-group">
            {THEMES.map((t) => (
              <label key={t.id} className="radio">
                <input
                  type="radio"
                  name="theme"
                  checked={theme === t.id}
                  onChange={() => {
                    setTheme(t.id);
                    applyTheme(t.id);
                  }}
                />
                {t.label}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend>Spacing</legend>
          <div className="radio-group">
            {(['comfortable', 'compact'] as const).map((d) => (
              <label key={d} className="radio">
                <input
                  type="radio"
                  name="density"
                  checked={density === d}
                  onChange={() => {
                    setDensity(d);
                    applyDensity(d);
                  }}
                />
                {d === 'comfortable' ? 'Comfortable' : 'Compact'}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="muted">Motion is reduced automatically if your device asks for that.</p>
      </Section>

      <section id="assumptions" aria-labelledby="assumptions-heading" className="card">
        <div className="card-head">
          <h2 id="assumptions-heading" tabIndex={-1}>
            Assumptions for estimated value
          </h2>
        </div>
        <Notice tone="warn" title="Placeholders, not benchmarks">
          The defaults are illustrative. Replace them with your team&apos;s own figures; a short pilot that times manual reviews gives the most
          defensible numbers.
        </Notice>
        <form onSubmit={save}>
          <fieldset>
            <legend>Minutes a person spends reviewing one change by hand, without AEGIS</legend>
            <div className="field-grid">
              {levels.map((l) => (
                <Field key={l} id={`m-${l}`} label={`${l[0]!.toUpperCase()}${l.slice(1)} risk`}>
                  <input id={`m-${l}`} type="number" min={0} step={1} value={a.manualMinutes[l]} onChange={(e) => setA({ ...a, manualMinutes: { ...a.manualMinutes, [l]: num(e.target.value) } })} />
                </Field>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>Minutes a person still spends per change with AEGIS</legend>
            <div className="field-grid">
              {decisions.map((d) => (
                <Field key={d.id} id={`a-${d.id}`} label={d.label}>
                  <input id={`a-${d.id}`} type="number" min={0} step={1} value={a.assistedMinutes[d.id]} onChange={(e) => setA({ ...a, assistedMinutes: { ...a.assistedMinutes, [d.id]: num(e.target.value) } })} />
                </Field>
              ))}
            </div>
          </fieldset>
          <div className="field-grid">
            <Field id="rate" label="Cost of one reviewer hour">
              <input id="rate" type="number" min={0} step={1} value={a.hourlyRate} onChange={(e) => setA({ ...a, hourlyRate: num(e.target.value) })} />
            </Field>
            <Field id="cur" label="Currency code" hint="Three letters, for example USD or INR.">
              <input id="cur" value={a.currency} maxLength={3} onChange={(e) => setA({ ...a, currency: e.target.value.toUpperCase() })} aria-describedby="cur-hint" />
            </Field>
            <Field id="inc" label="Optional: cost of one serious incident" hint="Leave at 0 to hide the avoided-cost line.">
              <input id="inc" type="number" min={0} step={100} value={a.incidentCost} onChange={(e) => setA({ ...a, incidentCost: num(e.target.value) })} aria-describedby="inc-hint" />
            </Field>
          </div>
          <div className="row">
            <button type="submit">Save assumptions</button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                resetAssumptions();
                setA(DEFAULT_ASSUMPTIONS);
                setSaved(false);
              }}
            >
              Restore defaults
            </button>
          </div>
          <div role="status">{saved && <Notice tone="ok">Saved. The Business value page uses these numbers.</Notice>}</div>
        </form>
      </section>
    </>
  );
}
