import { useEffect, useMemo, useState } from 'react';
import { useDarkMode } from '../hooks/useDarkMode.js';
import { useNow } from '../hooks/useNow.js';
import {
  agencyLabel,
  currentlyOut,
  fetchAccessibilityData,
  outageDuration,
  outageHasLine,
  stationHref,
  stationLabel,
  stationReliability,
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

function unitLabel(outage) {
  return outage.unit_label || outage.unit_type || 'Accessibility unit';
}

function OutageRow({ outage, now }) {
  const href = stationHref(outage);
  const duration = formatDuration(outageDuration(outage, now)) || 'just now';
  const active = !!outage.lifecycle?.active;
  const lineKind = outage.agency === 'metra' ? 'metra' : 'train';
  return (
    <li className="rounded-lg border border-slate-200 dark:border-gh-border bg-white dark:bg-gh-surface p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {href ? (
              <a
                href={href}
                className="font-semibold text-slate-800 dark:text-slate-100 hover:underline"
              >
                {stationLabel(outage)}
              </a>
            ) : (
              <span className="font-semibold text-slate-800 dark:text-slate-100">
                {stationLabel(outage)}
              </span>
            )}
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {agencyLabel(outage.agency)}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{unitLabel(outage)}</p>
          {outage.headline && (
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 line-clamp-2">
              {outage.headline}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {(outage.station?.lines || []).map((line) => (
            <LinePill key={`${outage.agency}-${line}`} kind={lineKind} line={line} />
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 font-semibold ${
            active
              ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
              : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
          }`}
        >
          {active ? 'Out now' : 'Restored'}
        </span>
        <span>{active ? `${duration} so far` : `Lasted ${duration}`}</span>
        {outage.lifecycle?.first_seen_ts && (
          <span>Seen {formatDate(outage.lifecycle.first_seen_ts)}</span>
        )}
        {outage.source_url && (
          <a href={outage.source_url} className="text-blue-600 dark:text-blue-400 hover:underline">
            Source
          </a>
        )}
      </div>
    </li>
  );
}

function StationRow({ row }) {
  const href =
    row.slug == null
      ? null
      : row.agency === 'metra'
        ? `/metra/station/${row.slug}`
        : `/station/${row.slug}`;
  const lineKind = row.agency === 'metra' ? 'metra' : 'train';
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-2 border-b border-slate-100 dark:border-gh-border last:border-0">
      <div className="min-w-0 flex-1">
        {href ? (
          <a href={href} className="font-medium text-slate-700 dark:text-slate-200 hover:underline">
            {row.name}
          </a>
        ) : (
          <span className="font-medium text-slate-700 dark:text-slate-200">{row.name}</span>
        )}
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {agencyLabel(row.agency)} · {row.outageCount} outage{row.outageCount === 1 ? '' : 's'}
          {row.currentlyOut > 0 ? ` · ${row.currentlyOut} active` : ''}
        </p>
      </div>
      <div className="flex max-w-full flex-wrap justify-start gap-1.5 sm:justify-end">
        {(row.lines || []).map((line) => (
          <LinePill key={`${row.agency}-${line}`} kind={lineKind} line={line} />
        ))}
      </div>
    </li>
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
  const recentOutages = useMemo(
    () =>
      outages
        .filter((o) => !agencyFilter || o.agency === agencyFilter)
        .filter((o) => outageHasLine(o, line))
        .map((o) => ({ ...o, durationMs: outageDuration(o, now) }))
        .sort((a, b) => (b.lifecycle?.first_seen_ts || 0) - (a.lifecycle?.first_seen_ts || 0))
        .slice(0, 24),
    [outages, now, agencyFilter, line],
  );
  const stationRows = useMemo(
    () => stationReliability(outages, { now, agency: agencyFilter, line }).slice(0, 12),
    [outages, now, agencyFilter, line],
  );

  const ctaActive = agency === 'cta';
  const metraActive = agency === 'metra';

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-gh-canvas">
        <p className="text-red-600 text-sm">Failed to load accessibility data.</p>
      </div>
    );
  }

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
      <main id="main" tabIndex={-1} className="max-w-5xl mx-auto px-4 py-6 space-y-6 w-full flex-1">
        <div>
          <Breadcrumb items={topLevelTrail('Accessibility')} className="mb-3" />
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">
                Accessibility outages
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
                Elevator, escalator, entrance, and ADA notices for CTA rail stations and Metra
                stations, archived separately from general service disruptions.
              </p>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {data ? `${outages.length} records · ${data.window_days || 180}d window` : 'Loading…'}
            </p>
          </div>
        </div>

        <section className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => {
                  setAgency(f.key);
                  setLine(null);
                }}
                aria-pressed={agency === f.key}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                  agency === f.key
                    ? 'bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-800'
                    : 'bg-slate-100 dark:bg-gh-subtle text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-gh-border'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {(ctaActive || metraActive) && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setLine(null)}
                aria-pressed={line === null}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors ${
                  line === null
                    ? 'bg-slate-700 text-white'
                    : 'bg-slate-100 dark:bg-gh-subtle text-slate-500 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-gh-border'
                }`}
              >
                All lines
              </button>
              {(ctaActive ? TRAIN_LINE_ORDER : METRA_LINE_ORDER).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setLine(key)}
                  aria-pressed={line === key}
                  className={`rounded-full transition-opacity ${line && line !== key ? 'opacity-45' : ''}`}
                >
                  <LinePill kind={ctaActive ? 'train' : 'metra'} line={key} linked={false} />
                </button>
              ))}
            </div>
          )}
        </section>

        {!data && (
          <div className="space-y-3 animate-pulse">
            <div className="h-24 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border" />
            <div className="h-44 bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border" />
          </div>
        )}

        {data && (
          <>
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
                Out now
              </h2>
              {activeOutages.length === 0 ? (
                <div className="rounded-lg border border-slate-200 dark:border-gh-border bg-white dark:bg-gh-surface p-4 text-sm text-slate-500 dark:text-slate-400">
                  No active accessibility outages in this view.
                </div>
              ) : (
                <ul className="space-y-3">
                  {activeOutages.map((outage) => (
                    <OutageRow key={outage.id} outage={outage} now={now} />
                  ))}
                </ul>
              )}
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] gap-4">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
                  Recent notices
                </h2>
                <ul className="space-y-3">
                  {recentOutages.map((outage) => (
                    <OutageRow key={outage.id} outage={outage} now={now} />
                  ))}
                  {recentOutages.length === 0 && (
                    <li className="rounded-lg border border-slate-200 dark:border-gh-border bg-white dark:bg-gh-surface p-4 text-sm text-slate-500 dark:text-slate-400">
                      No accessibility notices in this view yet.
                    </li>
                  )}
                </ul>
              </div>
              <aside className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4 h-fit">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                  Most affected stations
                </h2>
                <ul>
                  {stationRows.map((row) => (
                    <StationRow key={`${row.agency}:${row.slug || row.name}`} row={row} />
                  ))}
                </ul>
              </aside>
            </section>
          </>
        )}
      </main>
      <Footer />
    </div>
  );
}
