-- 0047 — LINKED SOCIAL ACCOUNTS. `docs/rewards-round2-plan.md` §2.1.
--
-- Which GitHub / Discord account a DSIM account has proved it owns. Stage B and C of the
-- rewards plan read it; nothing else does.
--
-- ⚠️ A TABLE, NOT A COLUMN ON `profiles`, AND THE REASON IS THE UNLINK. `kofi_email` (0019)
-- is a column with a unique partial index, which says "one subscription cannot feed several
-- accounts" and is all that link needs to be. A provider link needs that guarantee AND it
-- needs to SURVIVE AN UNLINK — otherwise unlink-and-relink is a free reward mint, which is
-- the cheapest farm available against a star or a boost. So `(provider, provider_user_id)`
-- is the PRIMARY KEY and an unlink sets `unlinked_at` rather than deleting the row: one
-- GitHub account can ever earn once, on one DSIM account, forever.
--
-- ⚠️ WHAT IS STORED IS THE PROVIDER'S IMMUTABLE ID AND TWO TIMESTAMPS. NOTHING ELSE. No
-- login, no email, no avatar, and — the one that matters — NO ACCESS OR REFRESH TOKEN. Every
-- reward this feeds asks the platform about its OWN resource (the repo's stargazers, the
-- guild's members), never about the person, so the server never needs to act as the user and
-- never holds a credential that would let it. A login is re-fetchable and changes; an id does
-- not. `src/legalText.ts` covers the disclosure.
create table if not exists provider_links (
  provider          text        not null check (provider in ('github', 'discord')),
  provider_user_id  text        not null,
  user_id           text        not null references profiles(user_id) on delete cascade,
  linked_at         timestamptz not null default now(),
  -- set on unlink; the ROW STAYS so the primary key keeps holding the "earns once" promise
  unlinked_at       timestamptz,
  primary key (provider, provider_user_id)
);

-- leads with `user_id`, which is this table's only foreign key, so `npm run dbtest`'s first
-- schema invariant is satisfied by the index the read path ("what has this account linked?")
-- wanted anyway. The primary key leads with `provider`, so neither is a prefix of the other.
create index if not exists provider_links_user_idx on provider_links (user_id, provider);

comment on table provider_links is
  'Which external account a DSIM account has proved it owns, for the rewards ledger (docs/rewards-round2-plan.md). (provider, provider_user_id) is the PK and an unlink sets unlinked_at rather than deleting, so one external account earns once on one DSIM account forever. Stores the immutable provider id and two timestamps only — never a token, because every reward asks the platform about its own resource rather than about the person.';
