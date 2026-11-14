import { useMemo } from 'react';
import type { Item } from '../api';

interface Props {
  resources: Item[];
  edges: Item[];
}

const W = 860;
const ROW = 38;
const short = (id: string): string => {
  const parts = id.split('/');
  return `${(parts[parts.length - 3] ?? '').split('.').pop() ?? ''}/${parts[parts.length - 1] ?? ''}`.slice(
    0,
    38,
  );
};

/**
 * Dependency graph drawn as SVG (no chart library). Left column: consumers (resources whose properties reference an affected resource).
 * Right column: resources changed by the deployment. Solid line = confirmed reference. Dashed line = inferred (same resource group only).
 * The table below the graph carries the same data for screen-reader and keyboard users.
 */
export default function DependencyGraph({ resources, edges }: Props) {
  const model = useMemo(() => {
    const changed = resources.filter((r) => r.change_type !== 'NoChange' && r.change_type !== 'Ignore');
    const consumerIds = [...new Set(edges.map((e) => String(e.from_resource_id)))].slice(0, 40);
    return { changed: changed.slice(0, 40), consumerIds };
  }, [resources, edges]);
  const rows = Math.max(model.changed.length, model.consumerIds.length, 1);
  const H = rows * ROW + 40;
  const yOf = (i: number, n: number): number => 30 + i * ROW + ((rows - n) * ROW) / 2;
  const cy = (id: string): number =>
    yOf(Math.max(0, model.consumerIds.indexOf(id)), model.consumerIds.length);
  const ty = (id: string): number =>
    yOf(
      Math.max(
        0,
        model.changed.findIndex((r) => r.resource_id === id),
      ),
      model.changed.length,
    );
  if (model.changed.length === 0) return <p className="empty">No changed resources to draw.</p>;
  const confirmed = edges.filter((e) => e.kind === 'confirmed-reference').length;
  return (
    <figure>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Dependency graph: ${model.changed.length} changed resources, ${confirmed} confirmed dependencies, ${edges.length - confirmed} inferred relationships`}
        className="graph"
      >
        <text x={20} y={16} className="graph-h">
          Consumers (depend on a changed resource)
        </text>
        <text x={W - 20} y={16} textAnchor="end" className="graph-h">
          Changed resources
        </text>
        {edges.map((e, i) => {
          if (
            !model.consumerIds.includes(String(e.from_resource_id)) ||
            !model.changed.some((r) => r.resource_id === e.to_resource_id)
          )
            return null;
          return (
            <line
              key={i}
              x1={280}
              y1={cy(String(e.from_resource_id))}
              x2={W - 300}
              y2={ty(String(e.to_resource_id))}
              className={e.kind === 'confirmed-reference' ? 'edge-confirmed' : 'edge-inferred'}
            />
          );
        })}
        {model.consumerIds.map((id, i) => (
          <g key={id}>
            <rect
              x={20}
              y={yOf(i, model.consumerIds.length) - 14}
              width={260}
              height={28}
              rx={6}
              className="node"
            />
            <text x={30} y={yOf(i, model.consumerIds.length) + 4}>
              {short(id)}
            </text>
          </g>
        ))}
        {model.changed.map((r, i) => (
          <g key={String(r.resource_id)}>
            <rect
              x={W - 300}
              y={yOf(i, model.changed.length) - 14}
              width={280}
              height={28}
              rx={6}
              className={`node node-${String(r.change_type).toLowerCase()}`}
            />
            <text x={W - 290} y={yOf(i, model.changed.length) + 4}>
              {String(r.change_type)}: {short(String(r.resource_id))}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="muted">
        Solid line = confirmed reference; dashed = inferred (same resource group, weak signal). Runtime
        dependencies are not visible to AEGIS.{' '}
        {model.consumerIds.length === 0 &&
          'No consumers were found (or dependency evidence was unavailable: see the summary tab).'}
      </figcaption>
    </figure>
  );
}
