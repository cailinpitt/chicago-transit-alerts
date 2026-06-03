import { useEffect, useState } from 'react';
import { flattenIncidents } from '../lib/incidents.js';

// Load alerts.json purely to populate the Header's Browse menu on pages whose
// own content doesn't already fetch it (the calendar and the A–Z index pages).
// Returns the flattened `{ alerts, observations }` shape the menu expects, or
// nulls until the fetch resolves. Best-effort: a failed fetch just leaves the
// menu's dynamic (bus/station) sections empty rather than surfacing an error.
export function useBrowseData() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch(`${import.meta.env.BASE_URL}data/alerts.json`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        if (alive) setData(payload?.incidents ? flattenIncidents(payload.incidents) : null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return { alerts: data?.alerts ?? null, observations: data?.observations ?? null };
}
