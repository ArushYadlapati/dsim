import { useEffect, useState } from 'react';
import { CORE_TEAM, CONTRIBUTORS, THIRD_PARTY, type Contributor } from '../contributors';
import { fetchProfileByUsername } from '../net/api';
import { LINKS } from '../seasons';

/**
 * Contributors — the people, sponsor and open-source projects behind the sim, linked
 * from the footer.
 *
 * Display names are NOT hardcoded. The whole point of the handle system is that
 * `handle` is the one source of truth for what a player is called and can change
 * at any time, so each card resolves its own live handle from `inGameUsername`
 * and falls back to the static `fallbackName` while that's in flight, when the
 * contributor has no game account, or when the game server is unreachable.
 *
 * One fetch per contributor is fine at this size; past ~15 people this wants a
 * batch endpoint rather than N parallel requests.
 */
export function Contributors({ onOpenProfile }: { onOpenProfile: (username: string) => void }) {
  return (
    <>
      <h1 className="ds-h1">Contributors</h1>

      <section className="ds-panel">
        <div className="ds-panel-h">
          <span className="ds-panel-title">Core team</span>
          <span className="ds-count">{CORE_TEAM.length}</span>
        </div>
        <div className="ds-panel-body">
          <div className="contrib-grid">
            {CORE_TEAM.map((c) => (
              <ContributorCard key={c.fallbackName} c={c} onOpenProfile={onOpenProfile} />
            ))}
          </div>
        </div>
      </section>

      <section className="ds-panel">
        <div className="ds-panel-h">
          <span className="ds-panel-title">Contributors</span>
          <span className="ds-count">{CONTRIBUTORS.length}</span>
        </div>
        <div className="ds-panel-body">
          {/* No caption under this grid. It read "Names link to that driver's
              in-game profile where they have one" — a sentence explaining that
              links are links, under cards where the linked names already
              hover-underline in the accent colour and the unlinked ones already
              render as `.static` plain text. */}
          <div className="contrib-grid">
            {CONTRIBUTORS.map((c) => (
              <ContributorCard key={c.fallbackName} c={c} onOpenProfile={onOpenProfile} />
            ))}
          </div>
        </div>
      </section>

      {/* NO "Presented by" HERE. `AppShell`'s `<SponsorFooterMark />` already carries it on
          every shell screen, including this one — a second mark on this page said the same
          thing twice in one scroll. The contracted `footer` placement (docs/area/sponsor.md)
          lives there and only there; this page does not need its own. */}

      {/* THIRD-PARTY CREDITS. A separate panel rather than more cards in the grid above: these
          are not people who worked on DSIM, and putting a stranger's name in "Built by" would
          credit them for something they did not do. Rows, not cards — a licence and a link are
          a table, and `docs/ui-standard.md` §6 says a row is label left, value right.
          `.credit-row` on `.ds-field`: plain `.cap` is a FORM FIELD caption, 12px and muted
          because the control beside it (an input, a slider) carries the real weight. Here the
          caption IS the row's content — the package name — so reusing it undersold the one
          thing each row exists to say, and left the version number (a `.val`, bold and
          accent-coloured by design) reading as more important than what it is a version OF. */}
      {THIRD_PARTY.length > 0 && (
        <section className="ds-panel">
          <div className="ds-panel-h">
            <span className="ds-panel-title">Third-party</span>
            <span className="ds-count">{THIRD_PARTY.length}</span>
          </div>
          <div className="ds-panel-body stack">
            {THIRD_PARTY.map((a) => (
              <div key={a.name} className="ds-field credit-row">
                {/* BOTH LINKS LIVE IN THE HINT, not in the caption. `.ds-hint a` is the app's
                    only anchor colour rule — there is no global one (see its own comment in
                    shell.css) — so an anchor in a `.cap` would render UA-blue on a themed
                    panel, which is the `--accent` class of bug written up in CLAUDE.md. */}
                <span className="cap">
                  {a.name} <span className="val">{a.version ? `v${a.version}` : a.source}</span>
                </span>
                <p className="ds-hint">
                  {a.credits.map((c, i) => (
                    <span key={c.name}>
                      {i > 0 && ', '}
                      {c.name} ({c.role.toLowerCase()})
                    </span>
                  ))}
                  {' · '}
                  <a href={a.licenseUrl} target="_blank" rel="noreferrer">
                    {a.license}
                  </a>
                  {' · '}
                  {a.use}
                  {' · '}
                  <a href={a.page} target="_blank" rel="noreferrer">
                    Original
                  </a>
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="ds-panel">
        <div className="ds-panel-h">
          <span className="ds-panel-title">Get involved</span>
        </div>
        <div className="ds-panel-body stack">
          <div className="ds-field credit-row">
            <span className="cap">Source code</span>
            <p className="ds-hint">
              DSIM is open source — read it, fork it, or send a pull request on{' '}
              <a href={LINKS.repo} target="_blank" rel="noreferrer">
                GitHub
              </a>
              .
            </p>
          </div>
          <div className="ds-field credit-row">
            <span className="cap">Contributor agreement</span>
            <p className="ds-hint">
              A pull request needs a signed{' '}
              <a href={`${LINKS.repo}/blob/main/CLA.md`} target="_blank" rel="noreferrer">
                Contributor License Agreement
              </a>{' '}
              — see{' '}
              <a href={`${LINKS.repo}/blob/main/CONTRIBUTING.md`} target="_blank" rel="noreferrer">
                CONTRIBUTING.md
              </a>{' '}
              for how to sign it.
            </p>
          </div>
          <div className="ds-field credit-row">
            <span className="cap">Community</span>
            <p className="ds-hint">
              Join the{' '}
              <a href={LINKS.discord} target="_blank" rel="noreferrer">
                Discord
              </a>
              .
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

function ContributorCard({
  c,
  onOpenProfile,
}: {
  c: Contributor;
  onOpenProfile: (username: string) => void;
}) {
  const [handle, setHandle] = useState<string | null>(null);

  useEffect(() => {
    const username = c.inGameUsername;
    if (!username) return;
    let cancelled = false;
    fetchProfileByUsername(username)
      .then((p) => {
        if (!cancelled) setHandle(p.handle);
      })
      // no game server, asleep, or the account was deleted — the static name stands
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [c.inGameUsername]);

  const name = handle ?? c.fallbackName;
  const username = c.inGameUsername;
  const open = (): void => {
    if (username) onOpenProfile(username);
  };

  return (
    <div className="contrib-card">
      <Avatar url={c.discordAvatarUrl} name={name} />
      <div className="contrib-body">
        {/* NO `title` on either of these. Both said "View <name>'s profile", on
            two adjacent controls, over visible labels that already name the
            person — the button text IS the accessible name. */}
        {username ? (
          <button className="contrib-name" onClick={open}>
            {name}
          </button>
        ) : (
          <span className="contrib-name static">{name}</span>
        )}
        {username ? (
          <button className="contrib-user" onClick={open}>
            @{username}
          </button>
        ) : (
          c.role && <span className="contrib-user static">{c.role}</span>
        )}
        {/* `aria-label` only, no `title`. The glyph has no visible label so the
            aria-label is required; the title just duplicated it into a hover
            tooltip on an obvious Discord/GitHub mark. */}
        <div className="contrib-icons">
          {c.discordUrl && (
            <a
              className="contrib-icon"
              href={c.discordUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`${name} on Discord`}
            >
              <DiscordGlyph />
            </a>
          )}
          {c.githubUrl && (
            <a
              className="contrib-icon"
              href={c.githubUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`${name} on GitHub`}
            >
              <GitHubGlyph />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/** Discord avatar, or the contributor's initials when there's no URL on file.
 * `onError` covers a dead CDN link so a broken-image icon never ships. */
function Avatar({ url, name }: { url?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  if (!url || failed) return <div className="contrib-avatar fallback">{initials || '?'}</div>;
  return (
    <img
      className="contrib-avatar"
      src={url}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function DiscordGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M20.32 4.37A19.8 19.8 0 0 0 15.43 3a13.9 13.9 0 0 0-.63 1.28 18.4 18.4 0 0 0-5.6 0A13.4 13.4 0 0 0 8.57 3 19.7 19.7 0 0 0 3.68 4.38C.57 9 -.28 13.53.15 18a19.9 19.9 0 0 0 6 3.03c.48-.66.91-1.36 1.28-2.09a13 13 0 0 1-2.02-.97c.17-.12.34-.25.5-.38a14.2 14.2 0 0 0 12.18 0c.16.14.33.26.5.38-.65.38-1.33.7-2.03.97.37.73.8 1.43 1.28 2.09a19.8 19.8 0 0 0 6.01-3.03c.5-5.18-.85-9.67-3.53-13.64ZM8.02 15.33c-1.18 0-2.15-1.08-2.15-2.41s.95-2.42 2.15-2.42 2.17 1.09 2.15 2.42c0 1.33-.95 2.41-2.15 2.41Zm7.96 0c-1.18 0-2.15-1.08-2.15-2.41s.95-2.42 2.15-2.42 2.17 1.09 2.15 2.42c0 1.33-.95 2.41-2.15 2.41Z" />
    </svg>
  );
}

function GitHubGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M12 .5C5.73.5.7 5.53.7 11.8c0 4.99 3.24 9.22 7.73 10.72.57.1.78-.25.78-.55v-2.1c-3.15.69-3.81-1.34-3.81-1.34-.52-1.31-1.26-1.66-1.26-1.66-1.03-.7.08-.69.08-.69 1.14.08 1.74 1.17 1.74 1.17 1.01 1.74 2.66 1.24 3.31.95.1-.73.4-1.24.72-1.53-2.51-.29-5.15-1.26-5.15-5.6 0-1.24.44-2.25 1.17-3.04-.12-.29-.51-1.44.11-3 0 0 .95-.3 3.12 1.16a10.8 10.8 0 0 1 5.68 0c2.17-1.46 3.12-1.16 3.12-1.16.62 1.56.23 2.71.11 3 .73.79 1.17 1.8 1.17 3.04 0 4.35-2.65 5.31-5.17 5.59.41.35.77 1.04.77 2.1v3.11c0 .3.2.66.79.55A11.31 11.31 0 0 0 23.3 11.8C23.3 5.53 18.27.5 12 .5Z" />
    </svg>
  );
}
