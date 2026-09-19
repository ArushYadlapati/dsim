import { useCallback, useEffect, useState } from 'react';
import { adminFetchAudit, adminFetchAuditActions, type AuditRow } from '../net/api';
import { AccountName, CopyId, When, downloadCsv } from './adminBits';

/**
 * THE AUDIT LOG — every admin action, newest first (migration 0041).
 *
 * The console could already do a great deal that nothing recorded. A forced rename, a record
 * deleted, every record a player ever set cleared, a season rolled, archived replays purged,
 * the whole service locked down: each of those was a `console.log` on a machine that
 * auto-stops when idle, which is not an audit trail. The four things that DID leave a record
 * left it in four different tables in four different shapes, so "what happened on Tuesday"
 * had no answer at all.
 *
 * READ-ONLY BY CONSTRUCTION. There is no route that edits or deletes a row here, and adding
 * one would defeat the point of the table. Rows outlive their targets on purpose — no foreign
 * key either side — so deleting an account does not erase the record of what was done to it.
 *
 * ⚠️ IT DOES NOT POLL. Every other panel in the console watches something that changes on its
 * own; this one changes only when an admin presses a button, and those are the same people
 * looking at it. A five-second timer here would be a database query per admin per five
 * seconds to re-read rows that are almost always identical.
 */
const PAGE = 50;

export function AdminAudit({ onOpenUser }: { onOpenUser?: (userId: string) => void }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actions, setActions] = useState<string[]>([]);
  const [action, setAction] = useState('');
  const [query, setQuery] = useState('');
  // what the SERVER is currently filtered by, as opposed to what is typed in the box. The
  // search is submitted rather than live: it is an `ilike` across five columns, and firing it
  // on every keystroke is a scan per character typed.
  const [applied, setApplied] = useState('');
  const [offset, setOffset] = useState(0);

  const load = useCallback(
    async (nextOffset: number, q: string, act: string, append: boolean): Promise<void> => {
      setBusy(true);
      const page = await adminFetchAudit({ limit: PAGE, offset: nextOffset, q: q || undefined, action: act || undefined });
      setBusy(false);
      setErr(page === null);
      if (!page) return;
      setRows((cur) => (append && cur ? [...cur, ...page.rows] : page.rows));
      setMore(page.more);
      setOffset(nextOffset);
    },
    [],
  );

  useEffect(() => {
    void load(0, '', '', false);
    void adminFetchAuditActions().then(setActions);
  }, [load]);

  const refilter = (nextAction: string, nextQuery: string): void => {
    setAction(nextAction);
    setApplied(nextQuery);
    void load(0, nextQuery, nextAction, false);
  };

  return (
    <>
      <h2 className="ds-h2">Audit log</h2>
      <p className="ds-sub adm-sub">
        Every action taken from this console, with who took it, what it was taken against, and
        why. Nothing here can be edited or deleted, and a row outlives the account it names.
      </p>

      <div className="adm-toolbar">
        <select
          value={action}
          aria-label="Filter by action"
          onChange={(e) => refilter(e.target.value, applied)}
        >
          <option value="">Every action</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <input
          type="search"
          className="adm-grow"
          value={query}
          placeholder="Search a name, a reason, an id…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && refilter(action, query.trim())}
        />
        <button className="ds-btn small" disabled={busy} onClick={() => refilter(action, query.trim())}>
          Search
        </button>
        {(applied || action) && (
          <button
            className="ds-btn ghost small"
            disabled={busy}
            onClick={() => {
              setQuery('');
              refilter('', '');
            }}
          >
            Clear
          </button>
        )}
        <button
          className="ds-btn ghost small"
          disabled={!rows || rows.length === 0}
          onClick={() =>
            downloadCsv(
              'admin-audit.csv',
              ['at', 'admin', 'action', 'targetUser', 'targetName', 'targetId', 'note', 'detail'],
              (rows ?? []).map((r) => [
                r.at,
                r.adminId,
                r.action,
                r.targetUser ?? '',
                r.targetHandle ?? '',
                r.targetId ?? '',
                r.note ?? '',
                JSON.stringify(r.detail),
              ]),
            )
          }
        >
          Export CSV
        </button>
      </div>

      {err && !rows ? (
        <div className="ds-empty">
          <div className="big">Couldn’t load the audit log</div>
          The game server is unreachable, or this account isn’t an admin on it.
        </div>
      ) : !rows ? (
        <div className="ds-loading">Reading the audit log…</div>
      ) : rows.length === 0 ? (
        <div className="ds-empty">
          <div className="big">Nothing here</div>
          {applied || action
            ? 'No action matches that filter. Clear it to see everything.'
            : 'No admin action has been recorded yet.'}
        </div>
      ) : (
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Target</th>
                <th>By</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <When at={r.at} />
                  </td>
                  <td>
                    <code className="adm-action">{r.action}</code>
                  </td>
                  <td>
                    {r.targetUser ? (
                      <AccountName
                        userId={r.targetUser}
                        handle={r.targetHandle}
                        username={r.targetUsername}
                        onOpen={onOpenUser}
                      />
                    ) : r.targetId ? (
                      <span className="adm-who">
                        <code className="adm-guest-id">{r.targetId}</code>
                        <CopyId id={r.targetId} label="id" />
                      </span>
                    ) : (
                      <span className="ds-muted">the service</span>
                    )}
                  </td>
                  <td>
                    <span className="adm-who">
                      <code className="adm-guest-id">{r.adminId === 'secret' ? 'deploy script' : r.adminId.slice(0, 8)}</code>
                      {r.adminId !== 'secret' && <CopyId id={r.adminId} label="admin id" />}
                    </span>
                  </td>
                  <td>
                    {r.note && <span className="adm-note-body">{r.note}</span>}
                    {Object.keys(r.detail).length > 0 && (
                      <span className="ds-muted adm-detail">
                        {Object.entries(r.detail)
                          .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                          .join(' · ')}
                      </span>
                    )}
                    {!r.note && Object.keys(r.detail).length === 0 && <span className="ds-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {more && (
        <div className="adm-more">
          <button
            className="ds-btn ghost small"
            disabled={busy}
            onClick={() => void load(offset + PAGE, applied, action, true)}
          >
            {busy ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </>
  );
}
