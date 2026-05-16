import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { installStaleAssetReload } from './lib/staleAssetReload.js';

// Reload long-open tabs after a deploy invalidates the cached HTML's
// hashed asset URLs. Without this, a tab left open overnight 404s on the
// CSS bundle and renders unstyled until the user hard-refreshes.
installStaleAssetReload();

import CalendarPage from './components/CalendarPage.jsx';
import ComparePage from './components/ComparePage.jsx';
import DayPage from './components/DayPage.jsx';
import EventPage from './components/EventPage.jsx';
import LinePage from './components/LinePage.jsx';
import NotFoundPage from './components/NotFoundPage.jsx';
import StationPage from './components/StationPage.jsx';
import StatsPage from './components/StatsPage.jsx';
import SystemHealthPage from './components/SystemHealthPage.jsx';

// Client-side routing. GitHub Pages serves `404.html` (a copy of `index.html`)
// for any unknown path, so the SPA boots and we dispatch to the right page
// here. Match patterns:
//   /event/:id            → individual event detail
//   /event/:id/resolved   → same view, but the prerendered OG card has the
//                           'Archived' badge hardcoded. Used by cta-insights
//                           resolution replies so Bluesky's URL-keyed card
//                           cache doesn't keep showing the original
//                           'Active' image after the incident resolves.
//   /line/:id      → train line page (e.g. /line/red, /line/blue)
//   /route/:id     → bus route page  (e.g. /route/66, /route/X9)
//   /station/:slug → train station page (e.g. /station/clark-division)
//   /day/:date     → single Chicago calendar day (YYYY-MM-DD)
//   /calendar      → 12-month calendar heatmap of daily incident counts
//   /stats         → leaderboard of worst day/hour/station/longest incident
//   /compare       → side-by-side comparison of up to 3 train lines or bus routes
//   /system/trains → mode-wide health dashboard for the L
//   /system/buses  → mode-wide health dashboard for buses
const path = window.location.pathname;
const eventMatch = /^\/event\/([^/?#]+)(?:\/resolved)?\/?$/.exec(path);
const lineMatch = /^\/line\/([^/?#]+)\/?$/.exec(path);
const routeMatch = /^\/route\/([^/?#]+)\/?$/.exec(path);
const stationMatch = /^\/station\/([^/?#]+)\/?$/.exec(path);
const dayMatch = /^\/day\/([^/?#]+)\/?$/.exec(path);
const calendarMatch = /^\/calendar\/?$/.exec(path);
const statsMatch = /^\/stats\/?$/.exec(path);
const compareMatch = /^\/compare\/?$/.exec(path);
const systemMatch = /^\/system\/(trains|buses)\/?$/.exec(path);

let page;
if (eventMatch) {
  page = <EventPage eventId={eventMatch[1]} />;
} else if (lineMatch) {
  page = <LinePage kind="train" lineId={lineMatch[1]} />;
} else if (routeMatch) {
  page = <LinePage kind="bus" lineId={routeMatch[1]} />;
} else if (stationMatch) {
  page = <StationPage slug={stationMatch[1]} />;
} else if (dayMatch) {
  page = <DayPage dateStr={dayMatch[1]} />;
} else if (calendarMatch) {
  page = <CalendarPage />;
} else if (statsMatch) {
  page = <StatsPage />;
} else if (compareMatch) {
  page = <ComparePage />;
} else if (systemMatch) {
  page = <SystemHealthPage kind={systemMatch[1] === 'trains' ? 'train' : 'bus'} />;
} else if (path === '/' || path === '') {
  page = <App />;
} else {
  page = <NotFoundPage />;
}

createRoot(document.getElementById('root')).render(<StrictMode>{page}</StrictMode>);
