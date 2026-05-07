// Merging and filtering logic for the alerts + observations feed.
// "Merging" pairs an official CTA alert with a matching bot observation on the
// same line within a 2-hour window so the two sources don't double-count.

// Merge bot observations into their matching official CTA alerts when they
// share the same line and overlapping time window. Returns:
//   merged           — combined alert+observation records
//   standaloneAlerts — alerts with no matching observation
//   standaloneObs    — observations with no matching alert
export function mergeMatchingIncidents(alerts, observations) {
  const BUFFER_MS = 2 * 60 * 60 * 1000; // 2-hour window on each side

  const usedObsIds = new Set();
  const usedAlertIds = new Set();
  const merged = [];

  for (const alert of alerts) {
    if (alert.kind !== 'train') continue;
    const alertEnd = (alert.resolved_ts || alert.last_seen_ts || Infinity) + BUFFER_MS;

    for (const obs of observations) {
      if (usedObsIds.has(obs.id)) continue;
      if (!alert.routes.includes(obs.line)) continue;

      const inWindow = obs.ts >= alert.first_seen_ts - BUFFER_MS && obs.ts <= alertEnd;

      if (inWindow) {
        merged.push({
          _type: 'merged',
          _sortTs: alert.first_seen_ts,
          alert_id: alert.alert_id,
          kind: alert.kind,
          routes: alert.routes,
          headline: alert.headline,
          first_seen_ts: alert.first_seen_ts,
          resolved_ts: alert.resolved_ts ?? obs.resolved_ts ?? null,
          active: alert.active || obs.active,
          post_url: alert.post_url,
          resolved_reply_url: alert.resolved_reply_url,
          from_station: obs.from_station,
          to_station: obs.to_station,
          obs_post_url: obs.post_url,
          obs_id: obs.id,
        });
        usedObsIds.add(obs.id);
        usedAlertIds.add(alert.alert_id);
        break; // one observation per alert
      }
    }
  }

  return {
    merged,
    standaloneAlerts: alerts.filter((a) => !usedAlertIds.has(a.alert_id)),
    standaloneObs: observations.filter((o) => !usedObsIds.has(o.id)),
  };
}

// Filter alerts and observations by selected train lines, bus toggle, and a
// start timestamp. Active incidents bypass the timestamp filter so they always
// appear. Bus observations are controlled independently of the train line
// filter — selecting Red Line doesn't hide bus observations when showBus=true.
export function filterIncidents(
  alerts,
  observations,
  { lines, startTs, showBus = true, busRoutes = null } = {},
) {
  const hasLineFilter = lines !== null && lines !== undefined;
  const hasBusRouteFilter = busRoutes && busRoutes.length > 0;

  const filteredAlerts = alerts.filter((a) => {
    if (hasLineFilter && !a.routes.some((r) => lines.includes(r))) return false;
    if (startTs && a.first_seen_ts < startTs && !a.active) return false;
    return true;
  });

  const filteredObs = observations.filter((o) => {
    const isBus = o.kind === 'bus';
    if (isBus) {
      if (!showBus) return false;
      if (hasBusRouteFilter && !busRoutes.includes(o.line)) return false;
    } else {
      if (hasLineFilter && !lines.includes(o.line)) return false;
    }
    if (startTs && o.ts < startTs && !o.active) return false;
    return true;
  });

  return { alerts: filteredAlerts, observations: filteredObs };
}
