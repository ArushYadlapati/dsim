#!/usr/bin/env bash
# Deploy the DECODE game server to Fly, then RE-APPLY the per-region VM sizes.
#
# Why this wrapper exists: `fly deploy` re-applies fly.toml's single `[[vm]]`
# (shared-cpu-4x) to EVERY machine, which resets the cheaper satellite regions.
# fly.toml has no way to express per-region VM sizes, so we shrink the satellites
# back here. ALWAYS deploy via this script, not a bare `fly deploy`.
#
# Sizing policy: iad (matchmaker + always-warm primary) runs shared-cpu-4x (from
# fly.toml — 4 shared vCPUs, ample headroom for the 60Hz loop without a dedicated
# vCPU's cost). [SUPERSEDED 2026-09-13: see LAUNCH SIZING below — iad is performance-2x and
# each satellite has its own size in SATELLITE_SIZES.] EVERY other region, INCLUDING sjc, runs shared-cpu-1x — much cheaper,
# but SHARED: a sustained match there can burn burst
# credits and throttle the 60Hz loop (the flap risk fly.toml warns about). They rarely
# host a match and auto-stop when idle, so the cost win outweighs it; bump back to a
# performance-* size if a far region starts flapping under real matches. Tune below.
#
# ALPHA: `./scripts/fly-deploy.sh --alpha` deploys the PREVIEW app from fly.alpha.toml
# instead — one region, its own database, and no satellites to re-shrink. The two are kept
# in one script on purpose: a second script is a second thing to forget to update, and the
# only real difference is which config file and which app name.
set -euo pipefail

ALPHA=0
ARGS=()
for arg in "$@"; do
  case "$arg" in
    --alpha) ALPHA=1 ;;
    *) ARGS+=("$arg") ;;
  esac
done
set -- ${ARGS+"${ARGS[@]}"}

if [ "$ALPHA" -eq 1 ]; then
  APP="${FLY_ALPHA_APP:-dsim-alpha}"
  CONFIG=fly.alpha.toml
  echo "==> ALPHA preview deploy ($APP) — production is untouched"
  # -c pins the config: without it `fly deploy` reads fly.toml and would deploy PRODUCTION
  # under an alpha app name, quietly giving the preview production's multi-region VM block.
  deploy_rc=0
  # --ha=false: Fly's default launches a SECOND machine for high availability, and for this
  # server that is not redundancy, it is a SPLIT. Rooms live in the process's memory and the
  # routing hints resolve to a REGION, not a machine — so two machines in one region means
  # two players can land on different ones and sit in different rooms with the same code,
  # which is exactly the cross-region bug this app just fixed, one level down.
  fly deploy --remote-only --ha=false -c "$CONFIG" -a "$APP" "$@" || deploy_rc=$?
  if [ "$deploy_rc" -ne 0 ]; then
    echo "!! fly deploy exited $deploy_rc — CHECK THE DEPLOY (fly machine list -a $APP)"
    exit "$deploy_rc"
  fi
  # no satellites here: the preview is single-region, so there is nothing to re-shrink
  echo "==> done. verify: fly machine list -a $APP"
  echo "    health: curl https://$APP.fly.dev/health"
  exit 0
fi

APP="${FLY_APP:-dohun-sim-decode}"

# THE FLEET, DECLARED. This line is the in-repo source of truth for which regions run
# a machine, and `npm run test:mm` asserts that server/regions.ts agrees with it.
#
# It exists because the two drifted and the failure was silent: `ord`, `gru` and `jnb`
# all had live machines while `DEPLOY_REGIONS` still listed five regions, and
# `interRegionMs` answers a RADIUS_MAX-sized penalty for any region it has no row for.
# So a player whose Anycast landing region was missing did not read as "far" — they read
# as unpairable until the search radius saturated six seconds later, and never at all if
# they had asked to stay region-local. Two players in the same city could not be matched
# to each other. Nothing logs when this happens.
#
# ADD A REGION HERE AND IN server/regions.ts (both DEPLOY_REGIONS and the RTT table) IN
# THE SAME CHANGE. The test fails if this list names a region the code does not know.
FLEET_REGIONS=(iad ord sjc lhr syd nrt gru jnb)

# EVERY region except the always-warm primary (iad) runs the cheap shared size.
# sjc joined this list 2026-07-20 (cost pass): US West is redundant with iad for
# the ~75% of games that are solo record runs, and it auto-stops when idle anyway.
# ord (US Central) joined 2026-09-06 for the same reason it is cheap to have: a
# satellite costs nothing while it is stopped, and it only wakes when somebody in
# the middle of the country actually hosts a room there.
# gru (Sao Paulo) and jnb (Johannesburg) joined the same day, on the same logic:
# both continents were >200ms from EVERY existing region, which is the difference
# between playable and not. There is NO Middle East region on Fly - the nearest
# option for those players stays lhr, or fra if it is ever added here.
#
# WARNING: EVERY SATELLITE STAYS IN SATELLITE_SIZES. Omitting a region here does not
# leave it ALONE, it leaves it to fly.toml, whose single [[vm]] is the PRIMARY's size
# (performance-2x). So a region missing from the list is UPSIZED to that on the next
# deploy, which is the exact bug this wrapper exists to prevent.
#
# LAUNCH SIZING (2026-09-13, BIOBUZZ + the alpha promotion). PER-REGION now, because the
# regions are not alike. Each entry is region:size:memoryMB. Reasoning, from docs/capacity.md:
#   · one server process uses ~one core (Node is single-threaded), so the only size step
#     that buys ROOMS is a DEDICATED core: ~8-10 driven rooms on performance-1x against 3-5 on
#     shared-cpu-1x, whose sustained baseline (~6% of a core) is about ONE busy room. A bigger
#     shared size barely helps; shared-cpu-1x is what flapped /health under a single match.
#   · US Central, US West and Europe carry real traffic, so they get the dedicated core.
#   · Sydney, Tokyo, São Paulo and Johannesburg rarely host, so they get shared-cpu-4x: four
#     shared vCPUs of baseline headroom (it sustained 2 rooms / 8 players at 0.244 cores).
#   · every satellite AUTO-STOPS, and a stopped machine bills only its rootfs, so a bigger
#     satellite costs money only while somebody is playing on it.
# The primary (iad) is not listed: it takes fly.toml's [[vm]], performance-2x/4096.
# performance-* enforces a 2048MB-per-core memory floor and shared-cpu-4x a 1024MB one, so
# the memory column is the floor, not a choice. Change a size HERE — a manual
# `fly machine update` is undone by the next deploy.
SATELLITE_SIZES=(
  ord:performance-1x:2048
  sjc:performance-1x:2048
  lhr:performance-1x:2048
  gru:shared-cpu-4x:1024
  jnb:shared-cpu-4x:1024
  syd:shared-cpu-4x:1024
  nrt:shared-cpu-4x:1024
)
SATELLITES=()
for entry in "${SATELLITE_SIZES[@]}"; do SATELLITES+=("${entry%%:*}"); done

echo "==> fly deploy ($APP)"
# NOTE: do NOT let a non-zero deploy skip the re-shrink below. `fly deploy` exits
# non-zero on transient api.machines.dev flakes (health-check wait timeouts, cancelled
# requests) even when every machine actually updated — and with `set -e` that aborted
# the script mid-way, silently leaving the satellites on shared-cpu-4x. Observed
# 2026-07-20. So capture the status, ALWAYS re-shrink, and re-raise at the end.
deploy_rc=0
fly deploy --remote-only -a "$APP" "$@" || deploy_rc=$?
[ "$deploy_rc" -ne 0 ] && echo "!! fly deploy exited $deploy_rc — re-applying VM sizes anyway, then failing"

echo "==> re-applying per-region VM sizes (satellites: ${SATELLITE_SIZES[*]})"
ids=$(fly machine list -a "$APP" --json | node -e '
  const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
  const want = new Set(process.argv.slice(1));
  for (const m of data) if (want.has(m.region)) console.log(`${m.region} ${m.id}`);
' "${SATELLITES[@]}")

while read -r region id; do
  [ -z "$id" ] && continue
  size=""
  memory=""
  for entry in "${SATELLITE_SIZES[@]}"; do
    if [ "${entry%%:*}" = "$region" ]; then
      rest="${entry#*:}"
      size="${rest%%:*}"
      memory="${rest#*:}"
    fi
  done
  if [ -z "$size" ] || [ -z "$memory" ]; then
    echo "!! no size listed for $region ($id), leaving it alone"
    continue
  fi
  fly machine update "$id" --vm-size "$size" --vm-memory "$memory" -a "$APP" -y >/dev/null
  echo "   $region ($id) -> $size/${memory}MB"
done <<< "$ids"

if [ "$deploy_rc" -ne 0 ]; then
  echo "!! VM sizes re-applied, but 'fly deploy' had exited $deploy_rc — CHECK THE DEPLOY."
  echo "   Often a transient API flake with the rollout actually complete; confirm every"
  echo "   machine shares one IMAGE and is 1/1: fly machine list -a $APP"
  exit "$deploy_rc"
fi

echo "==> done. verify: fly machine list -a $APP"
