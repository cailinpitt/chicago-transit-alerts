import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { installStaleAssetReload } from './lib/staleAssetReload.js';

// Reload long-open tabs after a deploy invalidates the cached HTML's
// hashed asset URLs. Without this, a tab left open overnight 404s on the
// CSS bundle and renders unstyled until the user hard-refreshes.
installStaleAssetReload();

// Route components are lazy-loaded so a visitor landing on one page (e.g. a
// shared /event/:id link, the bulk of social traffic) doesn't download the JS
// for every other page. Each becomes its own chunk and Rollup hoists shared
// deps (React, lib/*, common components) into shared chunks. `#root` is empty
// in both the SPA shell and the prerendered stubs, so there's no prerendered
// content for the Suspense fallback to flash over.
const App = lazy(() => import('./App.jsx'));
const AboutPage = lazy(() => import('./components/AboutPage.jsx'));
const CalendarPage = lazy(() => import('./components/CalendarPage.jsx'));
const ComparePage = lazy(() => import('./components/ComparePage.jsx'));
const DayPage = lazy(() => import('./components/DayPage.jsx'));
const EventPage = lazy(() => import('./components/EventPage.jsx'));
const LinePage = lazy(() => import('./components/LinePage.jsx'));
const NotFoundPage = lazy(() => import('./components/NotFoundPage.jsx'));
const PrivacyPage = lazy(() => import('./components/PrivacyPage.jsx'));
const RoutesIndexPage = lazy(() => import('./components/RoutesIndexPage.jsx'));
const StationPage = lazy(() => import('./components/StationPage.jsx'));
const StationsIndexPage = lazy(() => import('./components/StationsIndexPage.jsx'));
const StatsPage = lazy(() => import('./components/StatsPage.jsx'));
const SubscribePage = lazy(() => import('./components/SubscribePage.jsx'));
const SystemHealthPage = lazy(() => import('./components/SystemHealthPage.jsx'));
const WeekPage = lazy(() => import('./components/WeekPage.jsx'));

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
//   /stations      → A–Z index of every 'L' station
//   /routes        → index of every train line + bus route
//   /day/:date     → single Chicago calendar day (YYYY-MM-DD)
//   /week          → recap of the current Sun–Sat week
//   /week/:date    → recap of the week containing :date (YYYY-MM-DD); the
//                    canonical permalink uses that week's Sunday
//   /calendar      → 12-month calendar heatmap of daily incident counts
//   /stats         → leaderboard of worst day/hour/station/longest incident
//   /compare       → side-by-side comparison of up to 3 train lines or bus routes
//   /system/trains → mode-wide health dashboard for the L
//   /system/buses  → mode-wide health dashboard for buses
const path = window.location.pathname;
const eventMatch = /^\/event\/([^/?#]+)(?:\/resolved)?\/?$/.exec(path);
const lineMatch = /^\/line\/([^/?#]+)\/?$/.exec(path);
const metraLineMatch = /^\/metra\/line\/([^/?#]+)\/?$/.exec(path);
const routeMatch = /^\/route\/([^/?#]+)\/?$/.exec(path);
const stationsIndexMatch = /^\/stations\/?$/.exec(path);
const routesIndexMatch = /^\/routes\/?$/.exec(path);
const stationMatch = /^\/station\/([^/?#]+)\/?$/.exec(path);
const metraStationMatch = /^\/metra\/station\/([^/?#]+)\/?$/.exec(path);
const dayMatch = /^\/day\/([^/?#]+)\/?$/.exec(path);
const weekMatch = /^\/week(?:\/([^/?#]+))?\/?$/.exec(path);
const calendarMatch = /^\/calendar\/?$/.exec(path);
const statsMatch = /^\/stats\/?$/.exec(path);
const compareMatch = /^\/compare\/?$/.exec(path);
const systemMatch = /^\/system\/(trains|buses|metra)\/?$/.exec(path);
const aboutMatch = /^\/about\/?$/.exec(path);
const subscribeMatch = /^\/subscribe\/?$/.exec(path);
const privacyMatch = /^\/privacy\/?$/.exec(path);

let page;
if (eventMatch) {
  page = <EventPage eventId={eventMatch[1]} />;
} else if (lineMatch) {
  page = <LinePage kind="train" lineId={lineMatch[1]} />;
} else if (metraLineMatch) {
  page = <LinePage kind="metra" lineId={metraLineMatch[1]} />;
} else if (routeMatch) {
  page = <LinePage kind="bus" lineId={routeMatch[1]} />;
} else if (stationsIndexMatch) {
  page = <StationsIndexPage />;
} else if (routesIndexMatch) {
  page = <RoutesIndexPage />;
} else if (stationMatch) {
  page = <StationPage slug={stationMatch[1]} />;
} else if (metraStationMatch) {
  page = <StationPage slug={metraStationMatch[1]} kind="metra" />;
} else if (dayMatch) {
  page = <DayPage dateStr={dayMatch[1]} />;
} else if (weekMatch) {
  page = <WeekPage weekParam={weekMatch[1] ?? null} />;
} else if (calendarMatch) {
  page = <CalendarPage />;
} else if (statsMatch) {
  page = <StatsPage />;
} else if (compareMatch) {
  page = <ComparePage />;
} else if (systemMatch) {
  page = (
    <SystemHealthPage
      kind={systemMatch[1] === 'trains' ? 'train' : systemMatch[1] === 'metra' ? 'metra' : 'bus'}
    />
  );
} else if (aboutMatch) {
  page = <AboutPage />;
} else if (subscribeMatch) {
  page = <SubscribePage />;
} else if (privacyMatch) {
  page = <PrivacyPage />;
} else if (path === '/' || path === '') {
  page = <App />;
} else {
  page = <NotFoundPage />;
}

// `null` fallback keeps `#root` empty (its served state) for the brief moment
// the route chunk downloads — identical to the pre-render blank before this
// split, so no new flash. Each page renders its own loading skeleton once
// mounted.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Suspense fallback={null}>{page}</Suspense>
  </StrictMode>,
);
