-- 0040 — WHICH VERSION OF THE TERMS THIS ACCOUNT HAS ACCEPTED, AND WHEN.
--
-- There was no acceptance step at all. `src/legalText.ts` carried one "last updated" date,
-- the Terms page was reachable from the footer, and nothing anywhere recorded that anybody
-- had read it — so "using DSIM means you accept what follows", which is the first sentence
-- of that document, was a claim with no evidence behind it. A supporter membership is a
-- consumer sale and ranked play is a service with rules; both want a record of assent that
-- is a row rather than an inference.
--
-- TWO COLUMNS, NOT ONE. The VERSION is what the gate compares (`LEGAL_VERSION`, derived
-- from `LEGAL_UPDATED`), so a future revision asks everybody once and nobody twice. The
-- INSTANT is what makes the row evidence: "accepted the August 2026 terms" without a date
-- cannot answer when, which is the only question anyone asks of a consent record.
--
-- BOTH NULLABLE, AND NULL IS MEANINGFUL. Every account that exists today has never been
-- asked, and back-filling them with the current version would be recording an acceptance
-- that did not happen — the exact falsification this migration exists to prevent. So null
-- means never, and `termsGateState` turns that into a dialog on the next sign-in. Google
-- sign-ups arrive the same way (there is no form for them to have ticked a box on), which
-- is why the gate has to exist alongside the sign-up checkbox rather than instead of it.
--
-- NO INDEX, DELIBERATELY, and the two invariants `npm run dbtest` enforces are why it is
-- worth saying out loud rather than just omitting:
--
--   · EVERY FOREIGN KEY HAS AN INDEX LEADING WITH ITS OWN COLUMNS — this migration adds no
--     foreign key. Both columns hang off `profiles`, whose primary key is `user_id`, and
--     every read of them is a single-row lookup BY that key (`getTermsAcceptance`, and the
--     entitlements route beside it). There is nothing here for an index to help.
--   · NO INDEX IS A DEAD PREFIX OF ANOTHER — likewise untouched. An index on `terms_version`
--     would be the wrong thing to add speculatively: the column holds one value for almost
--     every row in the table (whatever the current revision is), so the planner could never
--     choose it, and it would cost a write on every profile insert forever. If a report ever
--     wants "who has not accepted", that is a full scan of a small table run by hand, not a
--     permanent write tax. Add one when a plan says to.
--
-- PURELY ADDITIVE (`add column if not exists`, no default, no backfill), so rolling the
-- server back is safe: an older build never selects these columns, and a client talking to
-- a server that predates the route reads `undefined`, which `termsGateState` answers
-- `'unknown'` to and does not block on.

alter table profiles add column if not exists terms_version text;
alter table profiles add column if not exists terms_accepted_at timestamptz;

comment on column profiles.terms_version is
  'The revision of the Terms of Use this account accepted, as the sortable key src/legalText.ts derives from LEGAL_UPDATED (e.g. ''2026-08-04''). Null = never asked, which is every account created before this migration and every OAuth sign-up; the client gate (src/ui/TermsGate.tsx) blocks until it matches the running build''s LEGAL_VERSION.';
comment on column profiles.terms_accepted_at is
  'When that acceptance was recorded, server-side (now() in Postgres, never a client clock). Null exactly when terms_version is null. It is what makes the row evidence rather than a flag.';
