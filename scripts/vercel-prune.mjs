#!/usr/bin/env node
// Prune old Vercel PREVIEW deployments for this project. Zero dependencies; the OWNER runs it.
//
// Why: every push to every branch creates a deployment, and a Hobby project keeps all of them
// (500+ by 2026-09-18). `vercel.json` now stops the builds for branches other than main/alpha;
// this script cleans up what already accumulated. DRY RUN by default — nothing is deleted
// unless `--yes` is passed. Production deployments and anything still carrying an alias are
// never touched, and the newest deployment of every branch is kept.
//
//   VERCEL_TOKEN=… node scripts/vercel-prune.mjs --project dsim [--team <slug>] [--days 14] [--yes]
//
// The token comes from vercel.com → Account → Tokens; pass it through the environment, never on
// the command line and never into this repo. Deleting a deployment is permanent.

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const YES = args.includes('--yes');
const PROJECT = opt('project', 'dsim');
const TEAM = opt('team', '');
const DAYS = Number(opt('days', '14'));
const TOKEN = process.env.VERCEL_TOKEN;
if (!TOKEN) {
  console.error('VERCEL_TOKEN is not set (vercel.com → Account → Tokens).');
  process.exit(2);
}
const API = 'https://api.vercel.com';
const team = TEAM ? `&teamId=${encodeURIComponent(TEAM)}` : '';
const headers = { Authorization: `Bearer ${TOKEN}` };

async function api(path, init) {
  const res = await fetch(`${API}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const cutoff = Date.now() - DAYS * 86_400_000;
const all = [];
let until = '';
for (;;) {
  const page = await api(`/v6/deployments?projectId=${encodeURIComponent(PROJECT)}&limit=100${until}${team}`);
  all.push(...page.deployments);
  const next = page.pagination?.next;
  if (!next || page.deployments.length === 0) break;
  until = `&until=${next}`;
}
console.log(`${all.length} deployments in project "${PROJECT}"`);

// newest per branch is kept, whatever its age
const newestByBranch = new Map();
for (const d of all) {
  const ref = d.meta?.githubCommitRef ?? d.meta?.gitlabCommitRef ?? d.meta?.bitbucketCommitRef ?? '(no branch)';
  const cur = newestByBranch.get(ref);
  if (!cur || d.created > cur.created) newestByBranch.set(ref, d);
}

const victims = all.filter((d) => {
  if (d.target === 'production') return false;                 // never production
  if (Array.isArray(d.alias) && d.alias.length > 0) return false; // never anything aliased
  if (d.created >= cutoff) return false;                        // younger than --days
  const ref = d.meta?.githubCommitRef ?? d.meta?.gitlabCommitRef ?? d.meta?.bitbucketCommitRef ?? '(no branch)';
  return newestByBranch.get(ref)?.uid !== d.uid;                // keep the newest per branch
});

console.log(`${victims.length} preview deployments older than ${DAYS} days would be deleted${YES ? '' : ' (dry run — pass --yes to delete)'}`);
for (const d of victims) {
  const ref = d.meta?.githubCommitRef ?? '?';
  const when = new Date(d.created).toISOString().slice(0, 10);
  console.log(`  ${when}  ${ref.padEnd(32)}  ${d.state.padEnd(9)}  ${d.url}`);
}
if (!YES) process.exit(0);

let done = 0;
for (const d of victims) {
  await api(`/v13/deployments/${d.uid}?${team.replace(/^&/, '')}`, { method: 'DELETE' });
  done++;
  if (done % 20 === 0) console.log(`  deleted ${done}/${victims.length}`);
}
console.log(`deleted ${done} deployments`);
