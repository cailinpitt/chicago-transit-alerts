import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import EventPage from './components/EventPage.jsx';
import LinePage from './components/LinePage.jsx';
import StationPage from './components/StationPage.jsx';

// Client-side routing. GitHub Pages serves `404.html` (a copy of `index.html`)
// for any unknown path, so the SPA boots and we dispatch to the right page
// here. Match patterns:
//   /event/:id     → individual event detail
//   /line/:id      → train line page (e.g. /line/red, /line/blue)
//   /route/:id     → bus route page  (e.g. /route/66, /route/X9)
//   /station/:slug → train station page (e.g. /station/clark-division)
const path = window.location.pathname;
const eventMatch = /^\/event\/([^/?#]+)\/?$/.exec(path);
const lineMatch = /^\/line\/([^/?#]+)\/?$/.exec(path);
const routeMatch = /^\/route\/([^/?#]+)\/?$/.exec(path);
const stationMatch = /^\/station\/([^/?#]+)\/?$/.exec(path);

let page;
if (eventMatch) {
  page = <EventPage eventId={eventMatch[1]} />;
} else if (lineMatch) {
  page = <LinePage kind="train" lineId={lineMatch[1]} />;
} else if (routeMatch) {
  page = <LinePage kind="bus" lineId={routeMatch[1]} />;
} else if (stationMatch) {
  page = <StationPage slug={stationMatch[1]} />;
} else {
  page = <App />;
}

createRoot(document.getElementById('root')).render(<StrictMode>{page}</StrictMode>);
