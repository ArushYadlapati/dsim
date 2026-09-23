import { useState } from 'react';
import { PersonRow, useUserSearch } from './FriendsPanel';

/**
 * "Search name or @username" — a standalone public search, independent of the friends
 * panel's own add-friend box. The same `useUserSearch` as `FriendsPanel`'s `AddFriend`
 * (debounce, stale-drop, a pending state), but this one just opens a profile — no
 * friend-request affordance.
 */
export function UserSearchBar({ onOpenProfile }: { onOpenProfile: (username: string) => void }) {
  const [query, setQuery] = useState('');
  const { results, searching } = useUserSearch(query);

  const pick = (username: string | null): void => {
    if (!username) return;
    onOpenProfile(username);
    setQuery(''); // clears the results too: a short query empties the search
  };

  return (
    <div className="ds-usersearch">
      <input
        className="ds-input"
        value={query}
        placeholder="Search name or @username"
        aria-label="Search for a player by display name or username"
        onChange={(e) => setQuery(e.target.value)}
      />
      {/* ONE dropdown whose CONTENTS change. The "no matches" line used to render
          OUTSIDE the box as bare body text, so typing one more character swapped a
          framed dropdown for unframed prose 4px higher up — the same input and the
          same action producing two different objects. */}
      {query.trim().length >= 2 && (
        <div className="ds-usersearch-results">
          {results.length === 0 ? (
            <p className="fr-empty">{searching ? 'Searching…' : 'No players found.'}</p>
          ) : (
            results.map((p) => (
              <PersonRow key={p.userId} p={p} onOpenProfile={pick} />
            ))
          )}
        </div>
      )}
    </div>
  );
}
