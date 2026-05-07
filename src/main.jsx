import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import EventPage from './components/EventPage.jsx';

// Match `/event/:id` so deep links from the share button render the detail
// view. GitHub Pages serves `404.html` (a copy of `index.html`) for any unknown
// path, so the SPA boots and we route here on the client.
const eventMatch = /^\/event\/([^/?#]+)\/?$/.exec(window.location.pathname);

createRoot(document.getElementById('root')).render(
  <StrictMode>{eventMatch ? <EventPage eventId={eventMatch[1]} /> : <App />}</StrictMode>,
);
