import { useEffect, useState } from 'react';
import { dataUrl } from '../lib/dataSource.js';
import { incidentRecords } from '../lib/incidents.js';

// Load alerts.json purely to populate the Header's Browse menu on pages whose
// own content doesn't already fetch it (the calendar and the A–Z index pages).
// Returns incident-derived official/detection records, or nulls until the fetch
// resolves. Best-effort: a failed fetch just leaves the menu's dynamic
// (bus/station) sections empty rather than surfacing an error.
export function useBrowseData() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch(dataUrl('alerts.json'), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
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
