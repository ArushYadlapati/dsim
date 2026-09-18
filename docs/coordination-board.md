# The parallel-sessions coordination board

Split out of `CLAUDE.md` on 2026-09-16. **The board is RETIRED** — `.coord.retired.json` is in
the repo root and `.coord.json` is not, which is the off switch having been thrown. Every
`coord` command is a silent no-op and this document is history. It was costing every session
~590 tokens to be told to ignore it.

If the board is ever set up again (`npm run coord:setup`), this is the protocol; put a pointer
back in CLAUDE.md at that point, not before.

---

## Parallel sessions — the coordination board

**This section applies only while `.coord.json` exists in the repo root. If it does not, skip
everything here and work normally — that is the ordinary state of this repo.**

Three people work this repo in parallel from separate Claude sessions on separate machines,
and the expensive failure is two of them building the same thing from different chats. The
board is one claim per person — what they are touching, **by path** — on a branch in a
separate PRIVATE repository. `docs/biobuzz/COORDINATION.md` is the protocol.

While it is configured:

- **Run `npm run coord` and read it before starting any new piece of work**, and before
  opening a file you did not expect to touch. If somebody else has claimed a path you are
  about to edit, **say so to the user before touching it.** Never silently work around a
  collision — the whole point is that it gets discussed.
- **Claim by path when the user says what you are working on**, and re-claim when the work
  moves: `npm run coord:claim -- "<what>" <path> [path…]`. Claim a directory when the work is
  a directory. `-- --clear` when the piece is finished.
- **Never put anything from the conversation into a claim label.** The automatic half of the
  payload is built only from `git` output and cannot leak a chat; the label is the one field
  a human types, so it is the one field that could.
- **A publish failing is not yours to fix.** The Stop hook publishes in a detached child and
  exits 0 by design. Do not chase it mid-task, and do not report it as a problem with the
  work.
- The board is a note, not a lock. It cannot stop anyone editing anything. **Git is the
  truth**; the board is only intent.

**THE SYSTEM HAS AN OFF SWITCH AND IT IS THE REPOSITORY ITSELF.** When the board repository
is deleted, or this account is removed from it, the publisher confirms it over two runs and
then RETIRES: `.coord.json` is renamed to `.coord.retired.json`, the `coord` remote is
removed, and every command here becomes a silent no-op. Nothing needs uninstalling and no
session needs telling. If you find `.coord.retired.json` and no `.coord.json`, the board is
over — **ignore this whole section and contribute normally.** Do not rename it back or
re-run `coord:setup` to "fix" it; that is the owner's call, not a fault to repair.

