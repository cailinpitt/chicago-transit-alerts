import { useEffect, useMemo, useState } from 'react';
import { useDarkMode } from '../hooks/useDarkMode.js';
import { useNow } from '../hooks/useNow.js';
import {
  agencyLabel,
  currentlyOut,
  fetchAccessibilityData,
  groupOutagesByStation,
  outageDuration,
  outageHasLine,
  stationHref,
  stationReliability,
  summarizeOutages,
} from '../lib/accessibility.js';
import { topLevelTrail } from '../lib/breadcrumbs.js';
import { TRAIN_LINE_ORDER } from '../lib/ctaLines.js';
import { formatDate, formatDuration } from '../lib/format.js';
import { METRA_LINE_ORDER } from '../lib/metraLines.js';
import Breadcrumb from './Breadcrumb.jsx';
import Footer from './Footer.jsx';
import Header from './Header.jsx';
import LinePill from './LinePill.jsx';

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'cta', label: 'CTA' },
  { key: 'metra', label: 'Metra' },
];

function StationLink({ outage }) {
  const name = outage.station?.name || 'Unmatched station';
  const href = stationHref(outage);
  if (!href) return <span>{name}</span>;
  return (
    <a href={href} className="hover:underline">
      {name}
    </a>
  );
}

function AgencyTag({ agency }) {
  return (
    <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
      {agencyLabel(agency)}
    </span>
  );
}

function StationLines({ outage }) {
  const lineKind = outage.agency === 'metra' ? 'metra' : 'train';
  return (
    <span className="flex flex-wrap gap-1">
      {(outage.station?.lines || []).map((line) => (
        <LinePill key={`${outage.agency}-${line}`} kind={lineKind} line={line} />
      ))}
    </span>
  );
}

function UnitDetail({ outage }) {
  return (
    <>
      <span className="capitalize">{outage.unit_type}</span>
      {outage.unit_label ? ` · ${outage.unit_label}` : ''} · out{' '}
      {formatDuration(outage.durationMs) || 'just now'}
    </>
  );
}

function StationOutageGroup({ group }) {
  const href = stationHref(group);
  const lineKind = group.agency === 'metra' ? 'metra' : 'train';
  const multi = group.outages.length > 1;
  return (
    <div className="px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-semibold text-slate-800 dark:text-slate-100">
          {href ? (
            <a href={href} className="hover:underline">
              {group.name}
            </a>
          ) : (
            <span>{group.name}</span>
          )}
        </span>
        {group.lines.length > 0 ? (
          <span className="flex flex-wrap items-center gap-1">
            {group.lines.map((line) => (
              <LinePill key={`${group.agency}-${line}`} kind={lineKind} line={line} compact />
            ))}
          </span>
        ) : (
          <AgencyTag agency={group.agency} />
        )}
        {multi ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-400/15 dark:text-amber-200">
            {group.outages.length} out
          </span>
        ) : (
          <span className="text-sm text-slate-500 dark:text-slate-400">
            · <UnitDetail outage={group.outages[0]} />
          </span>
        )}
      </div>
      {multi && (
        <ul className="mt-1 space-y-0.5 text-sm text-slate-500 dark:text-slate-400">
          {group.outages.map((outage) => (
            <li key={outage.id}>
              <UnitDetail outage={outage} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SummaryBar({ summary, agency }) {
  if (summary.total === 0) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200">
        No accessibility outages in this view right now.
      </div>
    );
  }
  const parts = [];
  if (!agency || agency === 'cta') parts.push(`CTA ${summary.cta}`);
  if (!agency || agency === 'metra') parts.push(`Metra ${summary.metra}`);
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100">
      <span className="font-semibold">
        {summary.total} {summary.total === 1 ? 'unit' : 'units'} out
      </span>
      <span className="text-amber-700/70 dark:text-amber-200/70">·</span>
      <span>
        {summary.stations} {summary.stations === 1 ? 'station' : 'stations'}
      </span>
      {agency == null && (
        <>
          <span className="text-amber-700/70 dark:text-amber-200/70">·</span>
          <span>{parts.join(' / ')}</span>
        </>
      )}
    </div>
  );
}

function RecentNoticeRow({ outage }) {
  const active = !!outage.lifecycle?.active;
  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-semibold text-slate-800 dark:text-slate-100">
            <StationLink outage={outage} />
          </span>
          <AgencyTag agency={outage.agency} />
          <StationLines outage={outage} />
        </div>
        <span
          className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
            active
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200'
              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200'
          }`}
        >
          {active ? 'Active' : 'Restored'}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        <span className="capitalize">{outage.unit_type}</span>
        {outage.unit_label ? ` · ${outage.unit_label}` : ''} ·{' '}
        {active
          ? `out ${formatDuration(outage.durationMs) || 'just now'}`
          : `down ${formatDuration(outage.durationMs) || 'briefly'}`}
      </p>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
        {active
          ? `Reported ${formatDate(outage.lifecycle?.first_seen_ts)}`
          : `Restored ${formatDate(outage.lifecycle?.restored_ts)}`}
      </p>
      {outage.headline && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{outage.headline}</p>
      )}
    </div>
  );
}

function Sparkline({ values }) {
  const max = Math.max(...values, 1);
  return (
    <span className="inline-flex h-8 items-end gap-0.5" aria-hidden="true">
      {values.map((v, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed weekly buckets
          key={i}
          className="w-1.5 rounded-sm bg-blue-500/70 dark:bg-blue-400/70"
          style={{ height: `${Math.max(2, (v / max) * 28)}px` }}
        />
      ))}
    </span>
  );
}

function Filters({ agency, line, onAgency, onLine }) {
  const showLines = agency === 'cta' || agency === 'metra';
  const lineOrder = agency === 'cta' ? TRAIN_LINE_ORDER : METRA_LINE_ORDER;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => onAgency(f.key)}
            aria-pressed={agency === f.key}
            className={`inline-flex min-h-[28px] items-center rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              agency === f.key
                ? 'bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-gh-surface dark:text-slate-300 dark:ring-gh-border dark:hover:bg-gh-subtle'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {showLines && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onLine(null)}
            aria-pressed={line === null}
            className={`inline-flex min-h-[28px] items-center rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              line === null
                ? 'bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-gh-surface dark:text-slate-300 dark:ring-gh-border dark:hover:bg-gh-subtle'
            }`}
          >
            All lines
          </button>
          {lineOrder.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onLine(key)}
              aria-pressed={line === key}
              className={`rounded-full transition-opacity ${line && line !== key ? 'opacity-45' : ''}`}
            >
              <LinePill kind={agency === 'cta' ? 'train' : 'metra'} line={key} linked={false} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AccessibilityPage() {
  const [dark, toggleDark] = useDarkMode();
  const now = useNow();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [agency, setAgency] = useState('all');
  const [line, setLine] = useState(null);

  useEffect(() => {
    fetchAccessibilityData().then(setData).catch(setError);
  }, []);

  useEffect(() => {
    document.title = 'Accessibility · Chicago Transit Alerts';
    return () => {
      document.title = 'Chicago Transit Alerts';
    };
  }, []);

  const outages = data?.outages || [];
  const agencyFilter = agency === 'all' ? null : agency;
  const activeOutages = useMemo(
    () => currentlyOut(outages, { now, agency: agencyFilter, line }),
    [outages, now, agencyFilter, line],
  );
  const activeSummary = useMemo(() => summarizeOutages(activeOutages), [activeOutages]);
  const activeGroups = useMemo(() => groupOutagesByStation(activeOutages), [activeOutages]);
  const recentOutages = useMemo(
    () =>
      outages
        .filter((o) => !agencyFilter || o.agency === agencyFilter)
        .filter((o) => outageHasLine(o, line))
        .map((o) => ({ ...o, durationMs: outageDuration(o, now) }))
        .sort((a, b) => (b.lifecycle?.first_seen_ts || 0) - (a.lifecycle?.first_seen_ts || 0))
        .slice(0, 20),
    [outages, now, agencyFilter, line],
  );
  const reliability = useMemo(
    () => stationReliability(outages, { now, windowDays: 90, agency: agencyFilter, line }),
    [outages, now, agencyFilter, line],
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-gh-canvas flex flex-col">
      <Header
        generatedAt={data?.generated_at}
        dark={dark}
        onToggleDark={toggleDark}
        onResetFilters={() => {
          window.location.href = '/';
        }}
      />
      <main id="main" tabIndex={-1} className="max-w-5xl mx-auto px-4 py-6 space-y-5 w-full flex-1">
        <div>
          <Breadcrumb items={topLevelTrail('Accessibility')} className="mb-3" />
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">
            Accessibility outages
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Elevator outages plus entrance and ADA notices for CTA rail and Metra stations, archived
            separately from general service disruptions.
          </p>
        </div>

        <Filters
          agency={agency}
          line={line}
          onAgency={(key) => {
            setAgency(key);
            setLine(null);
          }}
          onLine={setLine}
        />

        {error && <p className="text-red-600 text-sm">Failed to load accessibility data.</p>}

        {!error && !data && (
          <div className="space-y-3 animate-pulse">
            <div className="h-32 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border" />
            <div className="h-48 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border" />
          </div>
        )}

        {data && (
          <>
            <SummaryBar summary={activeSummary} agency={agencyFilter} />

            {activeOutages.length > 0 && (
              <section className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border overflow-hidden">
                <div className="p-4 border-b border-slate-100 dark:border-gh-border">
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Active outages ({activeOutages.length})
                  </h2>
                </div>
                <div className="divide-y divide-slate-100 dark:divide-gh-border">
                  {activeGroups.map((group) => (
                    <StationOutageGroup key={group.key} group={group} />
                  ))}
                </div>
              </section>
            )}

            <section className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border">
              <div className="p-4 border-b border-slate-100 dark:border-gh-border">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Recent notices
                </h2>
              </div>
              {recentOutages.length === 0 ? (
                <p className="p-4 text-sm text-slate-500 dark:text-slate-400">
                  No accessibility notices in this view yet.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-gh-border">
                  {recentOutages.map((outage) => (
                    <RecentNoticeRow key={outage.id} outage={outage} />
                  ))}
                </div>
              )}
            </section>

            <section className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border overflow-hidden">
              <div className="p-4 border-b border-slate-100 dark:border-gh-border">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Reliability over the last 90 days
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <tr className="border-b border-slate-100 dark:border-gh-border">
                      <th className="text-left font-semibold p-3">Station</th>
                      <th className="text-right font-semibold p-3">Outages</th>
                      <th className="text-right font-semibold p-3">Total downtime</th>
                      <th className="text-left font-semibold p-3">Weekly</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-gh-border">
                    {reliability.map((row) => {
                      const href = stationHref(row);
                      return (
                        <tr key={`${row.agency}:${row.slug || row.name}`}>
                          <td className="p-3 text-slate-800 dark:text-slate-100">
                            <span className="flex flex-wrap items-center gap-2">
                              {href ? (
                                <a href={href} className="font-medium hover:underline">
                                  {row.name}
                                </a>
                              ) : (
                                <span className="font-medium">{row.name}</span>
                              )}
                              <AgencyTag agency={row.agency} />
                              {row.currentlyOut > 0 && (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-400/15 dark:text-amber-200">
                                  {row.currentlyOut} active
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="p-3 text-right tabular-nums text-slate-600 dark:text-slate-300">
                            {row.outageCount}
                          </td>
                          <td className="p-3 text-right tabular-nums text-slate-600 dark:text-slate-300">
                            {formatDuration(row.totalDownMs) || '0m'}
                          </td>
                          <td className="p-3">
                            <Sparkline values={row.weeklyDownMs} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 dark:border-gh-border bg-white dark:bg-gh-surface p-4 text-sm leading-relaxed text-slate-600 dark:text-slate-300 space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                What's captured
              </h2>
              <p>
                CTA publishes <strong>elevator</strong> outages as a structured real-time feed, so
                each one is archived here as an outage with start and restore times. Entrance
                closures and other ADA notices are captured when they appear in the CTA or Metra
                alert feeds; Metra accessibility issues come from GTFS-realtime alerts.
              </p>
              <p>
                <strong>Escalators aren't included.</strong> CTA doesn't report individual escalator
                outages in real time — it only publishes monthly escalator availability in its{' '}
                <a
                  className="text-blue-500 hover:text-blue-400 hover:underline"
                  href="https://www.transitchicago.com/performance/"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  performance dashboard
                </a>
                . An empty escalator history would reflect the data CTA makes public, not an
                outage-free system.
              </p>
            </section>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
