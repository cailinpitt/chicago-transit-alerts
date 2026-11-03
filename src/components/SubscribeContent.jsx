import { useEffect, useState } from 'react';
import { BUS_ROUTE_NAMES, compareBusRoutes } from '../lib/busRoutes.js';
import { TRAIN_LINE_ORDER, TRAIN_LINES } from '../lib/ctaLines.js';
import { DATA_ORIGIN, dataUrl } from '../lib/dataSource.js';
import { METRA_LINE_ORDER, METRA_LINES } from '../lib/metraLines.js';

const LINK = 'text-blue-500 hover:text-blue-400 hover:underline';
const H2 = 'text-lg font-semibold text-slate-800 dark:text-slate-100';
const H3 = 'font-semibold text-slate-700 dark:text-slate-200 pt-2';
const NOTE = 'text-xs text-slate-500 dark:text-slate-400';
const FIELD =
  'flex-1 min-w-0 px-2 py-1.5 text-xs font-mono bg-slate-50 dark:bg-gh-canvas border border-slate-200 dark:border-gh-border rounded text-slate-700 dark:text-slate-200';
const BUTTON =
  'px-3 py-1.5 text-xs font-medium rounded border border-slate-200 dark:border-gh-border text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-gh-border transition-colors';

const SITE = 'https://chicagotransitalerts.app';
const FEED_URL = `${SITE}/feed.xml`;
const RECENT_URL = dataUrl('alerts-recent.json');
const LEGACY_JSON_URL = dataUrl('alerts.json');
const CHANGELOG_URL = 'https://chicagotransitalerts.app/data/CHANGELOG.md';
const POSITIONS_FILE_PATTERN = 'positions/{bus,train,metra}/YYYY/MM/YYYY-MM-DD.<sha256>.parquet';

const CURL_CMD = `curl -s ${RECENT_URL} | jq '.incidents | length'`;
const POSITIONS_CMD = `BASE=${DATA_ORIGIN}
MANIFEST=$(curl -s $BASE/positions/index.json | jq -r .path)
FILE=$(curl -s $BASE/$MANIFEST | jq -r '.days[0].files.train.path')
curl -so train.parquet $BASE/$FILE
duckdb -c "SELECT route, count(*) FROM 'train.parquet' GROUP BY route"`;
const POSITIONS_PY = `import json
from urllib.request import Request, urlopen
import pandas as pd

base = "${DATA_ORIGIN}/"
def fetch(path):
    req = Request(base + path, headers={"User-Agent": "positions-example/1"})
    with urlopen(req) as res:
        return res.read()

pointer = json.loads(fetch("positions/index.json"))
manifest = json.loads(fetch(pointer["path"]))
file = manifest["days"][0]["files"]["bus"]
open("bus.parquet", "wb").write(fetch(file["path"]))
df = pd.read_parquet("bus.parquet", columns=["route", "vehicle_id", "ts", "lat", "lon"])`;

const BLUESKY_ACCOUNTS = [
  ['ctaalertinsights', 'official CTA alerts plus full-line/route blackouts and roundups.'],
  ['ctatraininsights', 'bunching, gaps, and ghost-hour detections on the L.'],
  ['ctabusinsights', 'the same, for bus routes.'],
  ['metraalertinsights', 'Metra cancellations, late trains, and republished Metra alerts.'],
  ['metrainsights', 'Metra speed maps and performance recaps.'],
];

const INCIDENT_FILES = [
  {
    name: 'Recent incidents',
    file: 'alerts-recent.json',
    desc: 'Active incidents plus the last 93 days. The same data the live site reads, so poll this one.',
  },
  {
    name: 'Archive index',
    file: 'alerts-index.json',
    desc: 'Lists the monthly archive files and per-line files. Combine the monthly files for the full history.',
  },
  { name: 'CSV', file: 'alerts.csv', desc: 'One row per alert or observation.' },
  {
    name: 'Accessibility outages',
    file: 'accessibility.json',
    desc: 'Elevator, escalator, and ADA outages, the data behind the accessibility page.',
  },
];

const POSITION_FILES = [
  {
    name: 'Positions index',
    file: 'positions/index.json',
    desc: 'A small pointer to the current manifest, which lists every published day with each file’s path, row count, size, and checksum, plus the fields for each mode and known gaps.',
  },
];

// Picker options for the per-line/route feed chooser. Values are the feed path
// segment after `/feed/` (e.g. `line/red`, `route/66`).
const LINE_FEED_OPTIONS = TRAIN_LINE_ORDER.map((id) => ({
  value: `line/${id}`,
  label: `${TRAIN_LINES[id]?.label ?? id} Line`,
}));
const ROUTE_FEED_OPTIONS = Object.keys(BUS_ROUTE_NAMES)
  .sort(compareBusRoutes)
  .map((r) => ({
    value: `route/${r}`,
    label: BUS_ROUTE_NAMES[r] ? `#${r} ${BUS_ROUTE_NAMES[r]}` : `#${r}`,
  }));
// Metra feeds live under their own namespace (`metra/line/:line`) so a Metra
// route_id can never collide with a CTA train-line key.
const METRA_FEED_OPTIONS = METRA_LINE_ORDER.map((id) => ({
  value: `metra/line/${id}`,
  label: METRA_LINES[id]?.label ?? id,
}));

export default function SubscribeContent() {
  const [copied, setCopied] = useState(null);
  const [pickedCtaFeed, setPickedCtaFeed] = useState('line/red');
  const [pickedMetraFeed, setPickedMetraFeed] = useState('metra/line/me');
  const pickedCtaFeedUrl = `${SITE}/feed/${pickedCtaFeed}.xml`;
  const pickedMetraFeedUrl = `${SITE}/feed/${pickedMetraFeed}.xml`;

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = (key, text) => async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
    } catch {
      // Clipboard API can fail in older Safari / restrictive contexts; the
      // text is visible and selectable either way.
    }
  };

  return (
    <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
      <p className={NOTE}>
        Jump to:{' '}
        <a className={LINK} href="#get-alerts">
          Get alerts
        </a>{' '}
        ·{' '}
        <a className={LINK} href="#use-the-data">
          Use the data
        </a>
      </p>

      <section id="get-alerts" className="space-y-3 scroll-mt-4">
        <h2 className={H2}>Get alerts</h2>

        <h3 className={H3}>Follow on Bluesky</h3>
        <p>The bots post to Bluesky in real time. Follow the ones you care about:</p>
        <ul className="list-disc list-outside ml-5 space-y-1">
          {BLUESKY_ACCOUNTS.map(([handle, desc]) => (
            <li key={handle}>
              <a
                className={LINK}
                href={`https://bsky.app/profile/${handle}.chicagotransitalerts.app`}
                target="_blank"
                rel="noopener noreferrer"
              >
                @{handle}
              </a>
              : {desc}
            </li>
          ))}
        </ul>

        <h3 className={H3}>Your line or route</h3>
        <p>
          Pick a CTA line or route, or a Metra line, and add its feed to a feed reader. Every line
          and route has one, even if it's quiet so far.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <FeedPicker
            id="cta-feed-picker"
            label="CTA line or route"
            value={pickedCtaFeed}
            onChange={setPickedCtaFeed}
            url={pickedCtaFeedUrl}
            copied={copied === 'cta-picked'}
            onCopy={copy('cta-picked', pickedCtaFeedUrl)}
          >
            <optgroup label="Train Lines">
              {LINE_FEED_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
            <optgroup label="Bus Routes">
              {ROUTE_FEED_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          </FeedPicker>
          <FeedPicker
            id="metra-feed-picker"
            label="Metra line"
            value={pickedMetraFeed}
            onChange={setPickedMetraFeed}
            url={pickedMetraFeedUrl}
            copied={copied === 'metra-picked'}
            onCopy={copy('metra-picked', pickedMetraFeedUrl)}
          >
            {METRA_FEED_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </FeedPicker>
        </div>

        <h3 className={H3}>All alerts</h3>
        <p>
          One feed with the 50 most recent incidents across every line and route: official CTA and
          Metra alerts plus bot-detected disruptions.
        </p>
        <CopyField
          value={FEED_URL}
          label="Full feed URL"
          copied={copied === 'feed'}
          onCopy={copy('feed', FEED_URL)}
        />

        <p className={NOTE}>
          Works in any feed reader, such as{' '}
          <a className={LINK} href="https://feedly.com/" target="_blank" rel="noopener noreferrer">
            Feedly
          </a>
          ,{' '}
          <a
            className={LINK}
            href="https://www.inoreader.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Inoreader
          </a>
          , or{' '}
          <a
            className={LINK}
            href="https://netnewswire.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            NetNewsWire
          </a>
          . When an incident resolves, its entry updates, so most readers show it as unread again.
          Every feed also comes as JSON Feed: swap <code>.xml</code> for <code>.json</code>.
        </p>
      </section>

      <hr className="border-slate-200 dark:border-gh-border !mt-6" />

      <section id="use-the-data" className="space-y-3 scroll-mt-4">
        <h2 className={H2}>Use the data</h2>
        <p>
          Everything behind this site is published as open files. No sign-up or API key, just
          reasonable polling. Format changes are tracked in the{' '}
          <a className={LINK} href={CHANGELOG_URL} target="_blank" rel="noopener noreferrer">
            data changelog
          </a>
          .
        </p>

        <h3 className={H3}>Incidents</h3>
        <DataFileList items={INCIDENT_FILES} />
        <Details>
          <p className={NOTE}>
            Each JSON file holds a unified <code>incidents[]</code> array, so you never fetch the
            whole archive at once. The original full-history{' '}
            <a className={LINK} href={LEGACY_JSON_URL} target="_blank" rel="noopener noreferrer">
              alerts.json
            </a>{' '}
            is <strong>deprecated</strong> and will be retired, so use the files above instead.
          </p>
          <CopyField
            value={CURL_CMD}
            label="Example command"
            copied={copied === 'curl'}
            onCopy={copy('curl', CURL_CMD)}
            multiline
          />
        </Details>

        <h3 className={H3}>Vehicle positions</h3>
        <p>
          Every CTA bus, CTA train, and Metra position the bots poll, as one file per mode per day
          starting September 28, 2026. A new day appears each night.
        </p>
        <DataFileList items={POSITION_FILES} />
        <Details>
          <p className={NOTE}>
            Files are Parquet, sorted by route, vehicle, and time, at{' '}
            <code className="break-all">{POSITIONS_FILE_PATTERN}</code>. File names include a
            checksum: read <code>index.json</code>, follow its{' '}
            <code>path</code> to the manifest, and take each day's file <code>path</code> from
            there. Pin a manifest URL for repeatable analysis. Days run midnight to midnight Chicago
            time. Buses and Metra are polled about every 30 seconds (older bus files about once a
            minute), and trains at least every 30 seconds.
          </p>
          <CopyField
            value={POSITIONS_CMD}
            label="Example command"
            copied={copied === 'positions'}
            onCopy={copy('positions', POSITIONS_CMD)}
            multiline
          />
          <CopyField
            value={POSITIONS_PY}
            label="Python example"
            copied={copied === 'positions-py'}
            onCopy={copy('positions-py', POSITIONS_PY)}
            multiline
          />
        </Details>
      </section>
    </div>
  );
}

function Details({ children }) {
  return (
    <details className="group">
      <summary className="cursor-pointer list-none marker:hidden select-none text-xs text-blue-500 hover:text-blue-400 hover:underline">
        Details and an example{' '}
        <span className="inline-block group-open:rotate-180 transition-transform">▾</span>
      </summary>
      <div className="space-y-2 pt-2">{children}</div>
    </details>
  );
}

function DataFileList({ items }) {
  return (
    <ul className="space-y-2">
      {items.map(({ name, file, desc }) => (
        <li key={file}>
          <a
            className={`${LINK} font-medium`}
            href={dataUrl(file)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {name}
          </a>{' '}
          <code className={NOTE}>{file}</code>
          <p className={NOTE}>{desc}</p>
        </li>
      ))}
    </ul>
  );
}

function CopyField({ value, label, copied, onCopy, multiline = false }) {
  return (
    <div className="flex items-center gap-2">
      {multiline ? (
        <pre className={`${FIELD} whitespace-pre-wrap break-all`}>{value}</pre>
      ) : (
        <input
          type="text"
          readOnly
          value={value}
          onFocus={(e) => e.target.select()}
          aria-label={label}
          className={FIELD}
        />
      )}
      <button type="button" onClick={onCopy} className={BUTTON}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function FeedPicker({ id, label, value, onChange, url, copied, onCopy, children }) {
  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className="block text-xs font-semibold text-slate-600 dark:text-slate-300"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1.5 text-sm bg-slate-50 dark:bg-gh-canvas border border-slate-200 dark:border-gh-border rounded text-slate-700 dark:text-slate-200"
      >
        {children}
      </select>
      <CopyField value={url} label={`${label} feed URL`} copied={copied} onCopy={onCopy} />
    </div>
  );
}
