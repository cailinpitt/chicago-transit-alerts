import { useMemo, useState } from 'react';
import { TRAIN_LINES } from '../lib/ctaLines.js';
import { formatDate, formatTime, formatDuration, mergeMatchingIncidents } from '../lib/dataUtils.js';

const PAGE_SIZE = 25;

function LinePill({ kind, line, routes }) {
  const keys = routes?.length > 0 ? routes : [line];
  return (
    <>
      {keys.map((key) => {
        const info = kind === 'train' ? TRAIN_LINES[key] : null;
        if (info) {
          return (
            <span
              key={key}
              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
              style={{ backgroundColor: info.color, color: info.textColor }}
            >
              {info.label} Line
            </span>
          );
        }
        return (
          <span
            key={key}
            className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-slate-700 text-white"
          >
            {kind === 'bus' ? `Route ${key}` : key}
          </span>
        );
      })}
    </>
  );
}

function IncidentRow({ incident }) {
  const isMerged = incident._type === 'merged';
  const isAlert = !isMerged && !!incident.alert_id;

  const startTs = incident.first_seen_ts || incident.ts;
  const endTs = incident.resolved_ts ?? null;
  const duration = endTs ? formatDuration(endTs - startTs) : null;

  const description = isMerged || isAlert
    ? incident.headline
    : [incident.from_station, incident.to_station].filter(Boolean).join(' → ') ||
      'Service disruption detected';

  return (
    <div className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-0">
      <div className="flex-shrink-0 w-20 text-right">
        <p className="text-xs text-slate-500">{formatDate(startTs)}</p>
        <p className="text-xs text-slate-400">{formatTime(startTs)}</p>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 mb-1">
          <LinePill kind={incident.kind} line={incident.line} routes={incident.routes} />
          {isMerged && (
            <>
              <span className="text-xs text-slate-400 italic">via CTA</span>
              <span className="text-xs text-slate-300">·</span>
              <span className="text-xs text-slate-400 italic">via auto-detection</span>
            </>
          )}
          {!isMerged && isAlert && (
            <span className="text-xs text-slate-400 italic">via CTA</span>
          )}
          {!isMerged && !isAlert && (
            <span className="text-xs text-slate-400 italic">via auto-detection</span>
          )}
          {duration && (
            <span className="text-xs text-slate-400">{duration}</span>
          )}
          {!endTs && !incident.active && (
            <span className="text-xs text-slate-400">duration unknown</span>
          )}
          {incident.active && (
            <span className="text-xs font-semibold text-red-500">ongoing</span>
          )}
        </div>

        <p className="text-sm text-slate-700 leading-snug">{description}</p>

        {/* Merged: show the specific segment from the bot observation */}
        {isMerged && incident.from_station && incident.to_station && (
          <p className="text-xs text-slate-400 mt-0.5">
            {incident.from_station} → {incident.to_station}
          </p>
        )}

        {/* Links */}
        <div className="flex flex-wrap gap-3 mt-1.5">
          {incident.post_url && (
            <a
              href={incident.post_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:text-blue-700 hover:underline"
            >
              {isMerged ? 'Via CTA →' : 'View on Bluesky →'}
            </a>
          )}
          {isMerged && incident.obs_post_url && (
            <a
              href={incident.obs_post_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:text-blue-700 hover:underline"
            >
              Bot detection →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function IncidentList({ alerts, observations }) {
  const [page, setPage] = useState(1);

  const combined = useMemo(() => {
    const { merged, standaloneAlerts, standaloneObs } = mergeMatchingIncidents(alerts, observations);

    const all = [
      ...merged,
      ...standaloneAlerts.map((a) => ({ ...a, _sortTs: a.first_seen_ts || a.ts })),
      ...standaloneObs.map((o) => ({ ...o, _sortTs: o.first_seen_ts || o.ts })),
    ];
    all.sort((a, b) => b._sortTs - a._sortTs);
    return all;
  }, [alerts, observations]);

  const total = combined.length;
  const pageCount = Math.ceil(total / PAGE_SIZE);
  const visible = combined.slice(0, page * PAGE_SIZE);

  if (total === 0) {
    return (
      <section>
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Incident History
        </h2>
        <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-slate-400 text-sm">
          No incidents in this range.
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
        Incident History{' '}
        <span className="normal-case font-normal text-slate-400">({total})</span>
      </h2>
      <div className="bg-white rounded-lg border border-slate-200 px-4">
        {visible.map((incident) => (
          <IncidentRow
            key={incident.alert_id ?? `obs-${incident.id ?? incident.obs_id}`}
            incident={incident}
          />
        ))}
      </div>
      {page < pageCount && (
        <div className="mt-3 text-center">
          <button
            onClick={() => setPage((p) => p + 1)}
            className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Load more ({total - visible.length} remaining)
          </button>
        </div>
      )}
    </section>
  );
}
