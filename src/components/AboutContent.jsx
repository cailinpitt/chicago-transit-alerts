const LINK = 'text-blue-500 hover:text-blue-400 hover:underline';

export default function AboutContent() {
  return (
    <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
      <p>
        A public archive of Chicago Transit Authority and Metra service disruptions — one place to
        check how Chicago transit is doing right now, this week, or over the past few months.
      </p>
      <p className="text-xs italic text-slate-500 dark:text-slate-400">
        Unofficial. Not affiliated with, endorsed by, or sponsored by the Chicago Transit Authority
        or Metra.
      </p>

      <h3 className="font-semibold text-slate-700 dark:text-slate-200 pt-2">
        Where the data comes from
      </h3>
      <p>Five Bluesky bots feed this archive — three for the CTA, two for Metra:</p>
      <ul className="list-disc list-outside ml-5 space-y-2">
        <li>
          <a
            className={LINK}
            href="https://bsky.app/profile/ctaalertinsights.chicagotransitalerts.app"
            target="_blank"
            rel="noopener noreferrer"
          >
            <strong>@ctaalertinsights</strong>
          </a>{' '}
          — republished CTA service alerts, plus the bot's own detections: stretches without trains
          when service drops out of part of a line for 15+ minutes, full-line or full-route
          blackouts when nothing is running at all, and roundups when several smaller disruptions
          cluster on the same line or route at once.
        </li>
        <li>
          <a
            className={LINK}
            href="https://bsky.app/profile/ctatraininsights.chicagotransitalerts.app"
            target="_blank"
            rel="noopener noreferrer"
          >
            <strong>@ctatraininsights</strong>
          </a>{' '}
          — bot-detected train disruptions: bunching, long gaps versus the scheduled headway, and
          "ghost" hours when fewer trains are running than expected.
        </li>
        <li>
          <a
            className={LINK}
            href="https://bsky.app/profile/ctabusinsights.chicagotransitalerts.app"
            target="_blank"
            rel="noopener noreferrer"
          >
            <strong>@ctabusinsights</strong>
          </a>{' '}
          — the same kinds of disruptions, for bus routes.
        </li>
        <li>
          <a
            className={LINK}
            href="https://bsky.app/profile/metraalertinsights.chicagotransitalerts.app"
            target="_blank"
            rel="noopener noreferrer"
          >
            <strong>@metraalertinsights</strong>
          </a>{' '}
          — Metra disruptions: cancelled trains, trains running well behind schedule, and
          republished Metra service alerts.
        </li>
        <li>
          <a
            className={LINK}
            href="https://bsky.app/profile/metrainsights.chicagotransitalerts.app"
            target="_blank"
            rel="noopener noreferrer"
          >
            <strong>@metrainsights</strong>
          </a>{' '}
          — speed maps and periodic performance recaps across the Metra rail lines.
        </li>
      </ul>
      <p>
        When an official alert and a bot observation describe the same incident on the same line
        within a couple of hours, they're merged into a single entry rather than counted twice. This
        happens for both CTA and Metra; an alert and an observation never merge across agencies.
      </p>

      <h3 className="font-semibold text-slate-700 dark:text-slate-200 pt-2">
        How Metra detection works
      </h3>
      <p>
        Metra runs on a published timetable, so its detectors look different from the CTA's. A{' '}
        <strong>cancelled train</strong> is either Metra-confirmed (the agency's own feed flags the
        trip as cancelled) or bot-inferred — a scheduled train that never appears in the real-time
        feed long after its departure, with no covering alert. Inferred cancellations are held back
        whenever the whole feed goes quiet, so a data outage isn't mistaken for mass cancellations.
        A <strong>delayed train</strong> is one running materially behind its scheduled arrival
        (currently 15+ minutes). The Bluesky bot posts an hourly per-line digest of these; this
        website keeps the full record.
      </p>

      <h3 className="font-semibold text-slate-700 dark:text-slate-200 pt-2">Updates</h3>
      <p>
        Data refreshes every 7 minutes. The "Last data change" timestamp in the header tracks the
        most recent change to the alerts — not when the system last checked. An older time just
        means nothing new has happened.
      </p>

      <h3 className="font-semibold text-slate-700 dark:text-slate-200 pt-2">How far back</h3>
      <p>
        The CTA archive starts on April 26, 2026 — anything earlier than that predates the bots.
        Metra coverage began June 9, 2026. Stats, calendar, and leaderboard views all draw from this
        window.
      </p>

      <h3 className="font-semibold text-slate-700 dark:text-slate-200 pt-2">Privacy</h3>
      <p>
        No accounts, no cookies, and no advertising — the site doesn't collect personal data. It
        uses cookieless Cloudflare Web Analytics for rough, aggregate page-view counts, which don't
        identify or profile you. Your dark-mode and filter preferences are saved locally in your
        browser and never leave your device. Full details on the{' '}
        <a className={LINK} href="/privacy">
          privacy page
        </a>
        .
      </p>

      <p className="pt-2 text-xs text-slate-500 dark:text-slate-400">
        Source on{' '}
        <a
          className={LINK}
          href="https://github.com/cailinpitt/chicago-transit-alerts"
          target="_blank"
          rel="noopener noreferrer"
        >
          GitHub
        </a>
        .
      </p>
    </div>
  );
}
