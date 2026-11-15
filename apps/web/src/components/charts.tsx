import { useId, type ReactNode } from 'react';
import { Empty, Glyph, type Tone } from './ui';

const safeId = (raw: string): string => raw.replace(/[^a-zA-Z0-9_-]/g, '');

// ---------- stacked bars over time (patterns as well as colours, plus a data table for screen-reader and keyboard users)
export interface Series {
  key: string;
  label: string;
  pattern: 'solid' | 'dots' | 'hatch';
}
export function StackedBars({
  title,
  summary,
  data,
  series,
}: {
  title: string;
  summary: string;
  data: { label: string; values: Record<string, number> }[];
  series: Series[];
}) {
  const uid = safeId(useId());
  const totals = data.map((d) => series.reduce((s, x) => s + (d.values[x.key] ?? 0), 0));
  const maxV = Math.max(0, ...totals);
  if (data.length === 0 || maxV === 0) return <Empty>No changes in this period.</Empty>;
  const W = 720;
  const H = 260;
  const m = { l: 40, r: 8, t: 10, b: 30 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const step = maxV <= 5 ? 1 : Math.ceil(maxV / 5);
  const top = Math.ceil(maxV / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const bw = pw / data.length;
  const labelEvery = Math.ceil(data.length / 10);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${uid}-t`} aria-describedby={`${uid}-d`} className="chart-svg">
        <title id={`${uid}-t`}>{title}</title>
        <desc id={`${uid}-d`}>{summary}</desc>
        <defs>
          <pattern id={`${uid}-dots`} width="7" height="7" patternUnits="userSpaceOnUse">
            <circle cx="3.5" cy="3.5" r="1.4" className="pat-fg" />
          </pattern>
          <pattern id={`${uid}-hatch`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="7" strokeWidth="2.4" className="pat-fg" />
          </pattern>
        </defs>
        {ticks.map((t) => {
          const y = m.t + ph - (t / top) * ph;
          return (
            <g key={t}>
              <line x1={m.l} x2={W - m.r} y1={y} y2={y} className="grid-line" />
              <text x={m.l - 6} y={y + 4} textAnchor="end" className="axis-text">
                {t}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          let acc = 0;
          const x = m.l + i * bw + bw * 0.15;
          const w = bw * 0.7;
          return (
            <g key={d.label + i}>
              {series.map((s) => {
                const v = d.values[s.key] ?? 0;
                if (v === 0) return null;
                const h = (v / top) * ph;
                const y = m.t + ph - ((acc + v) / top) * ph;
                acc += v;
                return (
                  <g key={s.key}>
                    <rect x={x} y={y} width={w} height={h} className={`seg seg-${s.key}`} />
                    {s.pattern !== 'solid' && <rect x={x} y={y} width={w} height={h} fill={`url(#${uid}-${s.pattern})`} />}
                  </g>
                );
              })}
              {i % labelEvery === 0 && (
                <text x={x + w / 2} y={H - 10} textAnchor="middle" className="axis-text">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <ul className="legend" aria-label="Legend">
        {series.map((s) => (
          <li key={s.key}>
            <svg width="16" height="16" aria-hidden="true" focusable="false">
              <rect width="16" height="16" rx="3" className={`seg seg-${s.key}`} />
              {s.pattern !== 'solid' && (
                <rect width="16" height="16" rx="3" fill={`url(#${uid}-${s.pattern})`} />
              )}
            </svg>
            {s.label}: <strong>{data.reduce((sum, d) => sum + (d.values[s.key] ?? 0), 0)}</strong>
          </li>
        ))}
      </ul>
      <details className="chart-table">
        <summary>View this chart as a table</summary>
        <div className="table-wrap" tabIndex={0} role="region" aria-label={`${title} data`}>
          <table>
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                <th scope="col">Day</th>
                {series.map((s) => (
                  <th key={s.key} scope="col">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data
                .filter((d, i) => totals[i]! > 0)
                .map((d) => (
                  <tr key={d.label}>
                    <th scope="row">{d.label}</th>
                    {series.map((s) => (
                      <td key={s.key}>{d.values[s.key] ?? 0}</td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

// ---------- horizontal bars: plain list markup, so it is accessible without any ARIA tricks
export function HBarList({
  title,
  items,
  max,
  empty = 'Nothing to show yet.',
}: {
  title: string;
  items: { label: ReactNode; value: number; display?: string; tone?: Tone; note?: ReactNode }[];
  max?: number;
  empty?: string;
}) {
  if (items.length === 0 || items.every((i) => i.value === 0)) return <Empty>{empty}</Empty>;
  const top = max ?? Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="hbars" aria-label={title}>
      {items.map((it, i) => (
        <li key={i}>
          <span className="hb-label">
            {it.label}
            {it.note && <span className="hb-note">{it.note}</span>}
          </span>
          <span className="hb-track" aria-hidden="true">
            <span className={`hb-fill tone-${it.tone ?? 'info'}`} style={{ width: `${Math.max(2, (100 * it.value) / top)}%` }} />
          </span>
          <span className="hb-value">{it.display ?? it.value}</span>
        </li>
      ))}
    </ul>
  );
}

// ---------- donut with a text legend (counts and shares are always shown as text)
export function Donut({
  title,
  slices,
  centerValue,
  centerLabel,
}: {
  title: string;
  slices: { label: string; value: number; tone: Tone }[];
  centerValue: string;
  centerLabel: string;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total === 0) return <Empty>No assessed changes in this period.</Empty>;
  const r = 52;
  const c = 2 * Math.PI * r;
  let acc = 0;
  const summary = slices.map((s) => `${s.label} ${s.value}`).join(', ');
  return (
    <div className="donut">
      <svg viewBox="0 0 140 140" role="img" aria-label={`${title}: ${summary}`} className="donut-svg">
        <circle cx="70" cy="70" r={r} className="donut-bg" />
        {slices.map((s) => {
          const len = (s.value / total) * c;
          const off = -acc;
          acc += len;
          if (s.value === 0) return null;
          return (
            <circle
              key={s.label}
              cx="70"
              cy="70"
              r={r}
              className={`donut-seg tone-${s.tone}`}
              strokeDasharray={`${Math.max(0, len - 2)} ${c - Math.max(0, len - 2)}`}
              strokeDashoffset={off}
              transform="rotate(-90 70 70)"
            />
          );
        })}
        <text x="70" y="68" textAnchor="middle" className="donut-n">
          {centerValue}
        </text>
        <text x="70" y="86" textAnchor="middle" className="donut-l">
          {centerLabel}
        </text>
      </svg>
      <ul className="legend legend-col" aria-label={`${title} legend`}>
        {slices.map((s) => (
          <li key={s.label}>
            <span className={`swatch tone-${s.tone}`}>
              <Glyph tone={s.tone} />
            </span>
            {s.label}: <strong>{s.value}</strong> ({Math.round((100 * s.value) / total)}%)
          </li>
        ))}
      </ul>
    </div>
  );
}
