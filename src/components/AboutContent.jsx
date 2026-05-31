const LINK = 'text-blue-500 hover:text-blue-400 hover:underline';

export default function AboutContent() {
  return (
    <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
      <p>
        A public archive of Chicago Transit Authority service disruptions — one place to check how
        the CTA is doing right now, this week, or over the past few months.
      </p>
      <p className="text-xs italic text-slate-500 dark:text-slate-400">
        Unofficial. Not affiliated with, endorsed by, or sponsored by the Chicago Transit Authority.
      </p>

      <h3 className="font-semibold text-slate-700 dark:text-slate-200 pt-2">
        Where the data comes from
      </h3>
      <p>Three Bluesky bots feed this archive:</p>
      <ul className="list-disc list-outside ml-5 space-y-2">
        <li>
          <a
            className={LINK}
            href="https://bsky.app/profile/ctaalertinsights.bsky.social"
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
            href="https://bsky.app/profile/ctatraininsights.bsky.social"
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
            href="https://bsky.app/profile/ctabusinsights.bsky.social"
            target="_blank"
            rel="noopener noreferrer"
          >
            <strong>@ctabusinsights</strong>
          </a>{' '}
          — the same kinds of disruptions, for bus routes.
        </li>
      </ul>
      <p>
        When an official CTA alert and a bot observation describe the same incident on the same line
        within a couple of hours, they're merged into a single entry rather than counted twice.
      </p>

      <h3 className="font-semibold text-slate-700 dark:text-slate-200 pt-2">Updates</h3>
      <p>
        Data refreshes every 7 minutes. The "Last data change" timestamp in the header tracks the
        most recent change to the alerts — not when the system last checked. An older time just
        means nothing new has happened.
      </p>

      <h3 className="font-semibold text-slate-700 dark:text-slate-200 pt-2">How far back</h3>
      <p>
        The archive starts on April 26, 2026 — anything earlier than that predates the bots. Stats,
        calendar, and leaderboard views all draw from this window.
      </p>

      <h3 className="font-semibold text-slate-700 dark:text-slate-200 pt-2">Privacy</h3>
      <p>
        No accounts, no cookies, no analytics, and no third-party trackers — the site doesn't
        collect personal data. Your dark-mode and filter preferences are saved locally in your
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
