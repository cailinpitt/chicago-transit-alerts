import { useEffect, useMemo, useRef, useState } from 'react';
import { useMediaQuery } from '../hooks/useMediaQuery.js';
import { TRAIN_LINES } from '../lib/ctaLines.js';
import { fetchEventTrack } from '../lib/eventTracks.js';
import { hexToRgba } from '../lib/format.js';
import { buildLineMap, sliceTrackBetween } from '../lib/lineMap.js';
import { displayStationName, slugifyStation } from '../lib/stations.js';

// Trains drop out of the CTA feed for short stretches constantly (layovers at
// terminals, tunnels, missing predictions). We bridge gaps up to this long —
// interpolating straight through, since the train really is still running —
// because pulse-cold needs 15+ min of emptiness by definition, so an 8-min
// bridge still lets a genuinely cold stretch empty out. Past the cutoff the
// train isn't drawn through the unknown middle; it fades out at its last known
// spot and a ghost fades back in where it resurfaces.
const MAX_GAP_SEC = 480;
const STALE_FULL_SEC = 45; // within this of a real sample → full opacity
const BRIDGE_MIN_OPACITY = 0.5; // dimmest a dot gets while interpolated across a bridged gap
const GHOST_OPACITY = 0.5; // a parked dot at the edge of an un-bridgeable gap
// Playback-seconds over which a dot fades in/out at every appear, disappear,
// and gap boundary — so nothing pops; it eases. Kept short so it still reads at
// high speed.
const EDGE_FADE_SEC = 25;
// A 72-min window at 16× is still ~4.5 real minutes — accurate but tedious. The
// high multipliers make a whole incident watchable in well under a minute.
const SPEEDS = [8, 30, 60, 120];

function fmtClock(ms) {
  return new Date(ms).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Chicago',
  });
}

// Position + opacity of one vehicle at playhead `t` (seconds from t0), or null
// when it shouldn't be drawn. Handles three things so dots never pop:
//   - edge fades at the train's first/last sample (entering/leaving service),
//   - mild dimming while a position is interpolated across a bridged gap,
//   - a fading "ghost" parked at the last/next known spot on either side of an
//     un-bridgeable gap, with nothing drawn through the unknown middle.
function vehicleSample(v, t) {
  const s = v.s;
  if (!s || s.length === 0) return null;
  const first = s[0][0];
  const last = s[s.length - 1][0];
  if (t < first || t > last) return null;

  let i = 0;
  while (i < s.length - 1 && s[i + 1][0] <= t) i++;
  const a = s[i];
  const b = s[Math.min(i + 1, s.length - 1)];
  const gap = b[0] - a[0];

  let lat;
  let lon;
  let opacity;
  if (gap > MAX_GAP_SEC) {
    // Too long to bridge: park a ghost at the near endpoint for one fade, then
    // draw nothing until it fades back in approaching the far endpoint.
    const sinceA = t - a[0];
    const untilB = b[0] - t;
    if (sinceA <= EDGE_FADE_SEC) {
      lat = a[1];
      lon = a[2];
      opacity = GHOST_OPACITY * (1 - sinceA / EDGE_FADE_SEC);
    } else if (untilB <= EDGE_FADE_SEC) {
      lat = b[1];
      lon = b[2];
      opacity = GHOST_OPACITY * (1 - untilB / EDGE_FADE_SEC);
    } else {
      return null;
    }
  } else {
    const f = gap === 0 ? 0 : (t - a[0]) / gap;
    lat = a[1] + (b[1] - a[1]) * f;
    lon = a[2] + (b[2] - a[2]) * f;
    const stale = Math.min(t - a[0], b[0] - t);
    opacity =
      stale <= STALE_FULL_SEC
        ? 1
        : Math.max(
            BRIDGE_MIN_OPACITY,
            1 -
              ((stale - STALE_FULL_SEC) / (MAX_GAP_SEC / 2 - STALE_FULL_SEC)) *
                (1 - BRIDGE_MIN_OPACITY),
          );
  }

  // Ease in/out at the train's own appearance and disappearance.
  const edge = Math.min(t - first, last - t);
  if (edge < EDGE_FADE_SEC) opacity *= edge / EDGE_FADE_SEC;

  return { lat, lon, opacity };
}

// CTA Loop center — the aim point for "toward the Loop"/"downtown" labels,
// which name a destination area rather than a single terminus station.
const LOOP_CENTER = [41.8807, -87.6298];

// Grace on each side of the detected window. The actual red/clear timing is
// driven by train presence; this just scopes "this is the incident" so the
// segment doesn't flash red on every normal headway gap elsewhere in the clip.
const COLD_PAD_MS = 120000;

// Is a train dot inside the affected segment right now? Bounding box of the two
// endpoint stations (trains ride the line, so the box ≈ the stretch).
function dotInBox(d, a, b, margin = 9) {
  return (
    d.x >= Math.min(a.x, b.x) - margin &&
    d.x <= Math.max(a.x, b.x) + margin &&
    d.y >= Math.min(a.y, b.y) - margin &&
    d.y <= Math.max(a.y, b.y) + margin
  );
}

// "toward Midway" → slug for matching a terminus station. Returns null for
// non-station phrasings like "toward the Loop" (caller just skips the arrow).
function terminusSlug(directionLabel) {
  const m = directionLabel?.match(/toward\s+(.+)$/i);
  return m ? slugifyStation(m[1].trim()) : null;
}

// SVG path for a full arrow (shaft + V head, like "→") centered at (x,y) and
// pointing along `ang`. Stroked, not filled.
function arrowPath(x, y, ang, len = 34, head = 11) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const tipX = x + c * (len / 2);
  const tipY = y + s * (len / 2);
  const tailX = x - c * (len / 2);
  const tailY = y - s * (len / 2);
  const wing = (da) =>
    `${(tipX - Math.cos(ang + da) * head).toFixed(1)},${(tipY - Math.sin(ang + da) * head).toFixed(1)}`;
  return `M${tailX.toFixed(1)},${tailY.toFixed(1)}L${tipX.toFixed(1)},${tipY.toFixed(1)}M${wing(0.5)}L${tipX.toFixed(1)},${tipY.toFixed(1)}L${wing(-0.5)}`;
}

export default function EventReplay({ eventId, lineKey, fromStation, toStation, directionLabel }) {
  const [track, setTrack] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | none
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0); // playhead, seconds from track.t0
  const [speed, setSpeed] = useState(60);
  const rafRef = useRef(null);
  const lastRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    fetchEventTrack(eventId).then((data) => {
      if (cancelled) return;
      if (!data?.vehicles?.length) {
        setStatus('none');
        return;
      }
      setTrack(data);
      setT(0);
      setStatus('ready');
    });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  // On a phone, render the line in portrait (long axis vertical) so it fills
  // the screen's height instead of squishing into a wide sliver.
  const isMobile = useMediaQuery('(max-width: 640px)');
  const map = useMemo(
    () =>
      lineKey
        ? buildLineMap(
            lineKey,
            null,
            isMobile
              ? { maxWidth: 400, maxHeight: 640, margin: 16, preferPortrait: true }
              : { maxWidth: 720, maxHeight: 320 },
          )
        : null,
    [lineKey, isMobile],
  );

  // rAF playback loop. Advances the playhead by wall-clock delta × speed.
  useEffect(() => {
    if (!playing || !track) return undefined;
    lastRef.current = null;
    const tick = (now) => {
      if (lastRef.current != null) {
        const dt = (now - lastRef.current) / 1000;
        setT((prev) => Math.min(prev + dt * speed, track.durSec));
      }
      lastRef.current = now;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, track, speed]);

  // Auto-stop at the end so the loop doesn't spin on a clamped playhead.
  useEffect(() => {
    if (track && t >= track.durSec) setPlaying(false);
  }, [t, track]);

  if (status !== 'ready' || !map || !track) return null;

  const info = TRAIN_LINES[lineKey];
  const accent = info?.color ?? '#475569';
  const trackPaths = map.tracks
    .filter((tr) => tr.length >= 2)
    .map((tr) => `M${tr.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}`);

  const wanted = new Set([fromStation, toStation].filter(Boolean).map((n) => slugifyStation(n)));
  const affected = map.stations.filter((s) => wanted.has(slugifyStation(s.name)));
  const highlightPath =
    affected.length === 2 ? sliceTrackBetween(map.tracks, affected[0], affected[1]) : null;

  const clockMs = track.t0 + t * 1000;

  const dots = [];
  for (const v of track.vehicles) {
    const pos = vehicleSample(v, t);
    if (!pos) continue;
    const p = map.project(pos.lat, pos.lon);
    dots.push({ id: v.id, dir: v.dir, x: p.x, y: p.y, opacity: pos.opacity });
  }

  // Drive the "no service" highlight off whether a train is *physically* in the
  // segment right now (gated to the incident window), not the detector's
  // onset/resolved timestamps — which lead and lag the trains you can see. So
  // it turns red only once the last train clears the stretch, and snaps back the
  // instant one re-enters.
  const inWindow =
    clockMs >= track.onset - COLD_PAD_MS &&
    clockMs <= (track.resolved ?? Number.POSITIVE_INFINITY) + COLD_PAD_MS;
  // Only trains traveling in the *affected* direction count toward "is the
  // segment occupied" — an opposite-direction train passing through must not
  // clear a one-directional cold. affectedDir is baked in by the archiver
  // (matched from the direction label's terminus to the destination text);
  // null means undirected, so any train counts.
  const affectedDir = track.affectedDir ?? null;
  const segOccupied =
    affected.length === 2 &&
    dots.some(
      (d) =>
        (affectedDir == null || d.dir === affectedDir) && dotInBox(d, affected[0], affected[1]),
    );
  const coldActive = inWindow && affected.length === 2 && !segOccupied;

  // Arrow marking the affected direction of travel, pointing toward the named
  // terminus. Best-effort: only drawn when the direction label resolves to a
  // station on this line.
  const termSlug = terminusSlug(directionLabel);
  let targetPt = termSlug
    ? (map.stations.find((s) => slugifyStation(s.name) === termSlug) ?? null)
    : null;
  // "toward the Loop"/"downtown" isn't a station — aim at the downtown end.
  if (!targetPt && /loop|downtown/i.test(directionLabel ?? '')) {
    targetPt = map.project(LOOP_CENTER[0], LOOP_CENTER[1]);
  }
  let directionArrow = null;
  if (highlightPath && targetPt && affected.length === 2) {
    const d0 = Math.hypot(affected[0].x - targetPt.x, affected[0].y - targetPt.y);
    const d1 = Math.hypot(affected[1].x - targetPt.x, affected[1].y - targetPt.y);
    const near = d0 <= d1 ? affected[0] : affected[1];
    const far = d0 <= d1 ? affected[1] : affected[0];
    const ang = Math.atan2(near.y - far.y, near.x - far.x); // travel direction
    // Float the arrow off to the side of the segment (perpendicular to it), not
    // on the track where it blends in. Offset from the segment midpoint, and
    // pick whichever side sits farther from the map center so it lands in open
    // margin rather than over other track.
    const midX = (affected[0].x + affected[1].x) / 2;
    const midY = (affected[0].y + affected[1].y) / 2;
    const cx = map.width / 2;
    const cy = map.height / 2;
    const [base] = [ang + Math.PI / 2, ang - Math.PI / 2]
      .map((pa) => ({ x: midX + Math.cos(pa) * 30, y: midY + Math.sin(pa) * 30 }))
      .sort((p, q) => Math.hypot(q.x - cx, q.y - cy) - Math.hypot(p.x - cx, p.y - cy));
    directionArrow = arrowPath(base.x, base.y, ang);
  }

  const segLabel =
    fromStation && toStation
      ? `${displayStationName(fromStation)} → ${displayStationName(toStation)}`
      : null;

  return (
    <section className="mt-4">
      <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
        ▶ Watch it unfold
      </h2>
      {segLabel && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          {segLabel}
          {directionLabel ? ` · ${directionLabel}` : ''}
        </p>
      )}
      <div className="bg-white dark:bg-gh-surface rounded-lg border border-slate-200 dark:border-gh-border p-4">
        {/* Mobile: portrait line, sized to the screen's height and centered.
            Desktop: a wide landscape line — give it a minimum render width and
            let the card scroll horizontally rather than shrink to specks. */}
        <div className={isMobile ? 'flex justify-center' : 'overflow-x-auto -mx-1 px-1'}>
          <svg
            viewBox={`0 0 ${map.width} ${map.height}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={`Replay of trains on the ${info?.label ?? lineKey} Line`}
            className="block"
            style={
              isMobile
                ? { height: 'min(560px, 64vh)', width: 'auto', maxWidth: '100%' }
                : { width: '100%', height: 'auto', minWidth: Math.min(map.width, 560) }
            }
          >
            <title>{`Replay of ${dots.length} trains on the ${info?.label ?? lineKey} Line`}</title>
            {trackPaths.map((d) => (
              <path
                key={d}
                d={d}
                fill="none"
                stroke={hexToRgba(accent, 0.22)}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
            {highlightPath && (
              <path
                d={highlightPath}
                fill="none"
                stroke={coldActive ? '#ef4444' : hexToRgba(accent, 0.4)}
                strokeWidth={coldActive ? 6 : 4}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={coldActive ? '2 6' : undefined}
                opacity={0.9}
              />
            )}
            {/* Quiet station dots for context. */}
            {map.stations.map((s) => (
              <circle
                key={s.name}
                cx={s.x}
                cy={s.y}
                r={affected.includes(s) ? 5 : 2.5}
                fill={affected.includes(s) ? 'none' : '#cbd5e1'}
                stroke={affected.includes(s) ? accent : 'none'}
                strokeWidth={affected.includes(s) ? 2.5 : 0}
                className={affected.includes(s) ? '' : 'dark:[fill:#475569]'}
              >
                <title>{displayStationName(s.name)}</title>
              </circle>
            ))}
            {/* Affected-direction arrow — drawn above the station pins (with a
                halo) so it stays legible against the track and dots. */}
            {directionArrow && (
              <g strokeLinecap="round" strokeLinejoin="round" fill="none">
                {/* Halo underneath for legibility over the track + dots. */}
                <path
                  d={directionArrow}
                  stroke="white"
                  strokeWidth={6}
                  className="dark:[stroke:#0d1117]"
                />
                <path d={directionArrow} stroke={coldActive ? '#ef4444' : accent} strokeWidth={3} />
              </g>
            )}
            {/* Live train dots — projected each frame onto the same schematic.
              Opacity drops as a dot's position is bridged across a feed gap. */}
            {dots.map((d) => (
              <g key={d.id} opacity={d.opacity}>
                <circle cx={d.x} cy={d.y} r={9} fill={hexToRgba(accent, 0.25)} />
                <circle
                  cx={d.x}
                  cy={d.y}
                  r={5.5}
                  fill={accent}
                  stroke="white"
                  strokeWidth={2}
                  className="dark:[stroke:#0d1117]"
                >
                  <title>{`Run ${d.id}`}</title>
                </circle>
              </g>
            ))}
          </svg>
        </div>

        {/* Controls */}
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => {
              if (t >= track.durSec) setT(0);
              setPlaying((p) => !p);
            }}
            className="px-3 py-1.5 rounded-md bg-slate-800 text-white text-sm font-medium dark:bg-slate-200 dark:text-slate-900 min-w-[72px]"
          >
            {playing ? '❚❚ Pause' : '▶ Play'}
          </button>
          <input
            type="range"
            min={0}
            max={track.durSec}
            step={1}
            value={Math.round(t)}
            onChange={(e) => {
              setPlaying(false);
              setT(Number(e.target.value));
            }}
            className="flex-1 min-w-[160px] accent-slate-700 dark:accent-slate-300"
            aria-label="Scrub replay"
          />
          <div className="flex items-center gap-1">
            {SPEEDS.map((sp) => (
              <button
                type="button"
                key={sp}
                onClick={() => setSpeed(sp)}
                className={`px-2 py-1 rounded text-xs font-medium ${
                  speed === sp
                    ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                    : 'bg-slate-100 text-slate-600 dark:bg-gh-border dark:text-slate-300'
                }`}
              >
                {sp}×
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span className="tabular-nums">
            {fmtClock(clockMs)} · {dots.length} train{dots.length === 1 ? '' : 's'} on the line
          </span>
          {coldActive && (
            <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
              no service{directionLabel ? ` · ${directionLabel}` : segLabel ? ` · ${segLabel}` : ''}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
