import { useEffect, useRef, useState } from 'react';

export default function ShareLink({ eventId }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  if (!eventId) return null;

  const url = `${window.location.origin}/event/${eventId}`;

  async function handleClick(e) {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy this link', url);
    }
  }

  return (
    <a
      href={`/event/${eventId}`}
      onClick={handleClick}
      className="text-xs text-blue-500 hover:text-blue-400 hover:underline"
    >
      {copied ? 'Copied!' : 'Share 🔗'}
    </a>
  );
}
