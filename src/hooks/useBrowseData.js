import { useEffect, useState } from 'react';
import { loadRecent } from '../lib/incidentStore.js';
import { incidentRecords } from '../lib/incidents.js';

// Load the recent slice purely to populate the Header's Browse menu on pages
// whose own content doesn't already fetch it (the calendar and the A–Z index
// pages). The menu only shows top routes/stations over the last 90 days, which
// the 93-day recent slice fully covers — so it loads that bounded file, not the
// full history. Returns incident-derived official/detection records, or nulls
// until the fetch resolves. Best-effort: a failed fetch just leaves the menu's
// dynamic (bus/station) sections empty rather than surfacing an error.
export function useBrowseData() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    loadRecent()
      .then((payload) => {
        if (alive) setData(payload?.incidents ? incidentRecords(payload.incidents) : null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return {
    officialRecords: data?.officialRecords ?? null,
    detectionRecords: data?.detectionRecords ?? null,
  };
}
