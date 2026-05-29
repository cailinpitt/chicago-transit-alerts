// Pure derivations behind EventDetail's metadata callouts. Split out of the
// JSX so the fiddly time-bucketing math (… min / …h …m / …d …h ahead,
// early/late, the various skip thresholds) is unit-testable in isolation.

const MIN = 60_000;

// "5 min", "1h 30m", or "2h" from a positive millisecond span. Used for the
// bot-lead callout; ctaPlanned/ctaEstimate have their own suffixes.
export function formatLeadTime(ms) {
  const min = Math.round(ms / MIN);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// How far the earliest bot observation predates CTA's alert post — surfaced so
// the page doesn't read as if CTA detected first. Only for merged CTA+bot
// incidents; skipped under 2 min (CTA effectively kept pace). Returns
// `{ phrase, onsetTs }` or null.
export function computeBotLead({ isMerged, ctaFirstSeenTs, observations }) {
  if (!isMerged || ctaFirstSeenTs == null) return null;
  const earliestOnset = (observations || []).reduce(
    (min, o) => Math.min(min, o.onset_ts ?? o.ts),
    Number.POSITIVE_INFINITY,
  );
  if (!Number.isFinite(earliestOnset)) return null;
  const leadMs = ctaFirstSeenTs - earliestOnset;
  if (leadMs < 2 * MIN) return null;
  return { phrase: formatLeadTime(leadMs), onsetTs: earliestOnset };
}

// CTA-planned-ahead callout: an EventStart that predates our first sighting by
// 10 min–14 days marks a planned event rather than a live reactive post.
// Returns the "…ahead" phrase or null (gap too small, too large, or unknown).
export function computeCtaPlanned({ ctaStartTs, startTs }) {
  if (ctaStartTs == null || startTs == null) return null;
  const aheadMs = startTs - ctaStartTs;
  const TEN_MIN = 10 * MIN;
  const FOURTEEN_DAYS = 14 * 24 * 60 * MIN;
  if (aheadMs < TEN_MIN || aheadMs > FOURTEEN_DAYS) return null;
  const aheadMin = Math.round(aheadMs / MIN);
  if (aheadMin < 60) return `${aheadMin} min ahead`;
  if (aheadMin < 24 * 60) {
    const h = Math.floor(aheadMin / 60);
    const m = aheadMin % 60;
    return m > 0 ? `${h}h ${m}m ahead` : `${h}h ahead`;
  }
  const d = Math.floor(aheadMin / (24 * 60));
  const hours = Math.round((aheadMin - d * 24 * 60) / 60);
  return hours > 0 ? `${d}d ${hours}h ahead` : `${d}d ahead`;
}

// Retrospective comparison of actual resolution vs CTA's stated EventEnd.
// Returns `{ sameMinute, phrase }` or null. Skipped for date-only EventEnd (no
// minute precision to compare) and when the two are more than a week apart (a
// stale estimate from a multi-day planned alert isn't a useful comparison).
export function computeCtaEstimate({ ctaEndTs, resolvedTs, dateOnly }) {
  if (ctaEndTs == null || resolvedTs == null || dateOnly) return null;
  const deltaMs = resolvedTs - ctaEndTs;
  const WEEK_MS = 7 * 24 * 60 * MIN;
  if (Math.abs(deltaMs) > WEEK_MS) return null;
  const absMin = Math.round(Math.abs(deltaMs) / MIN);
  const sameMinute = absMin === 0;
  const earlyLate = deltaMs > 0 ? 'late' : 'early';
  const minPhrase =
    absMin < 60
      ? `${absMin} min`
      : `${Math.floor(absMin / 60)}h${absMin % 60 ? ` ${absMin % 60}m` : ''}`;
  return {
    sameMinute,
    phrase: sameMinute ? 'cleared right on schedule' : `${minPhrase} ${earlyLate}`,
  };
}
