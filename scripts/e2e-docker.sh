#!/usr/bin/env bash
# Full-stack e2e in Docker: db + api (the Render image) + web (production build) + fixture pages
# + a Playwright runner, all inside one private, egress-free network.
#
#   scripts/e2e-docker.sh            run the suite against a brand-new stack, then destroy it
#   scripts/e2e-docker.sh --keep     same, but leave the stack up for debugging (prints how to reach it)
#   scripts/e2e-docker.sh prune      destroy every stack and image this worktree ever created
#   scripts/e2e-docker.sh prune-all --yes   destroy every vm-e2e stack and image on this machine
#
# Isolation: every invocation creates its own compose project (`vm-e2e-<worktree>-<epoch>-<rand>`),
# its own network, its own throwaway database and its own report directory; it publishes no host
# ports and names no containers, so any number of worktrees / agents can run this at the same time,
# including twice in one worktree. Images are tagged per worktree, so one branch's build never
# replaces the image another branch is testing, while a re-run in the same worktree reuses its layers.
#
# Exit code is Playwright's. Reports: apps/web/playwright-report-docker/<run>/ (`latest` points at
# the newest). Long first build: agents should run this (and `pnpm gates`) in the background.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
compose_file="$root/docker/e2e/compose.yml"
reports_dir="$root/apps/web/playwright-report-docker"
stale_after_seconds=1800   # a stack this old was orphaned by a killed run (SIGKILL cannot be trapped)
keep_reports=5

hash_of() { printf '%s' "$1" | cksum | cut -d' ' -f1; }

# Stable per checkout path: the primary checkout and each .worktrees/<branch> get different tags.
slug="$(basename "$root" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9\n' '-' | sed 's/^-*//; s/-*$//' | cut -c1-24)"
worktree_tag="${slug:-wt}-$(printf '%08x' "$(hash_of "$root")")"
project_prefix="vm-e2e-${worktree_tag}"

command -v docker >/dev/null || { echo "e2e-docker: docker is not installed or not on PATH" >&2; exit 2; }
docker info >/dev/null 2>&1 || { echo "e2e-docker: the Docker daemon is not running" >&2; exit 2; }

projects_matching() { # $1 = anchored name prefix. Compose projects, plus stacks reduced to a bare network.
  {
    docker compose ls --all --quiet 2>/dev/null || true
    docker network ls --format '{{.Name}}' 2>/dev/null | sed -n 's/_default$//p'
  } | grep -E "^$1" | sort -u || true
}

destroy_project() { # $1 = project name
  # `compose run` containers can outlive `down` when the run was interrupted; remove by label first.
  docker ps --all --quiet --filter "label=com.docker.compose.project=$1" | xargs docker rm --force --volumes >/dev/null 2>&1 || true
  docker compose --project-name "$1" down --volumes --remove-orphans --timeout 5 >/dev/null 2>&1 || true
  docker network rm "${1}_default" >/dev/null 2>&1 || true
}

destroy_projects() { # $1 = anchored name prefix
  local p
  for p in $(projects_matching "$1"); do
    echo "e2e-docker: removing stack $p"
    destroy_project "$p"
  done
}

destroy_images() { # $1 = anchored tag regex
  local images
  images="$(docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -E "^vm-e2e-(api|web|runner):$1" || true)"
  if [ -n "$images" ]; then
    echo "$images" | xargs docker image rm --force >/dev/null
    echo "e2e-docker: removed $(echo "$images" | wc -l | tr -d ' ') image(s)"
  fi
}

reap_stale() { # this worktree's stacks whose name carries an epoch older than the threshold
  local p epoch now
  now="$(date +%s)"
  for p in $(projects_matching "$project_prefix-[0-9]"); do
    epoch="$(printf '%s' "${p#"$project_prefix"-}" | cut -d- -f1)"
    case "$epoch" in ''|*[!0-9]*) continue ;; esac
    if [ $((now - epoch)) -gt "$stale_after_seconds" ]; then
      echo "e2e-docker: reaping orphaned stack $p ($(( (now - epoch) / 60 )) min old)"
      destroy_project "$p"
    fi
  done
}

case "${1:-run}" in
  prune)     destroy_projects "$project_prefix-"; destroy_images "$worktree_tag\$"; rm -rf "$reports_dir"; exit 0 ;;
  prune-all)
    # Machine-wide: this kills other agents' in-flight runs, so it has to be asked for twice.
    [ "${2:-}" = "--yes" ] || { echo "e2e-docker: prune-all destroys EVERY worktree's stacks, running ones included. Re-run with: prune-all --yes" >&2; exit 2; }
    destroy_projects "vm-e2e-"; destroy_images ".*"; exit 0 ;;
  run|--keep) ;;
  *) echo "usage: scripts/e2e-docker.sh [--keep | prune | prune-all --yes]" >&2; exit 2 ;;
esac
keep=false; [ "${1:-}" = "--keep" ] && keep=true

# The runner image's browsers are tied to the @playwright/test version: read it, never hardcode it.
playwright_version="$(sed -n "s/^  '@playwright\/test@\([0-9][^']*\)':\$/\1/p" "$root/pnpm-lock.yaml" | head -1)"
[ -n "$playwright_version" ] || { echo "e2e-docker: could not read the @playwright/test version from pnpm-lock.yaml" >&2; exit 2; }

export VM_E2E_TAG="$worktree_tag"
export VM_E2E_PLAYWRIGHT_VERSION="$playwright_version"
export VM_E2E_OUT="$reports_dir"      # placeholder for `compose build`; set per run below
export VM_E2E_UID="$(id -u)" VM_E2E_GID="$(id -g)"
export VM_E2E_PROJECT="$project_prefix-build"   # `compose build` creates no containers or networks
export VM_E2E_SUBNET="11.0.0.0/24"   # placeholder for `compose build`; redrawn per attempt below
export DOCKER_BUILDKIT=1

compose() { docker compose --file "$compose_file" --project-name "$VM_E2E_PROJECT" "$@"; }

up_log="$(mktemp -t vm-e2e-up.XXXXXX)"
run_id=""
cleanup() {
  # An EXIT trap inherits `set -e`: one failing housekeeping command would skip the teardown and
  # replace Playwright's exit code. Nothing in here may abort, and the teardown goes first.
  set +e
  [ -z "$(jobs -p)" ] || kill $(jobs -p) 2>/dev/null   # an interrupted build / run
  rm -f "$up_log"
  [ -n "$run_id" ] || return 0                          # died before a stack existed
  $keep || destroy_project "$VM_E2E_PROJECT"
  ln -sfn "$run_id" "$reports_dir/latest" 2>/dev/null
  # Keep the newest few report directories (by name, i.e. by start time).
  ls -1 "$reports_dir" 2>/dev/null | grep -E '^(keep-)?[0-9]+-[0-9a-f]{8}$' | sort -t- -k2 -r | tail -n "+$((keep_reports + 1))" |
    while read -r old; do rm -rf "${reports_dir:?}/$old" 2>/dev/null; done
  if $keep; then
    echo
    echo "e2e-docker: --keep: stack $VM_E2E_PROJECT is still up (it has no route out and no host ports)."
    echo "  logs:   docker compose -p $VM_E2E_PROJECT logs -f api web"
    echo "  shell:  docker run --rm -it --network ${VM_E2E_PROJECT}_default -e E2E_WEB_ORIGIN=http://web:3000 -e E2E_API_ORIGIN=http://api:8080 -e E2E_FIXTURE_ORIGIN=http://fixtures.vm-e2e.test -v $out_dir:/out vm-e2e-runner:$VM_E2E_TAG bash"
    echo "  remove: scripts/e2e-docker.sh prune     (a --keep stack is never reaped automatically)"
  fi
}
trap cleanup EXIT
# Bash defers a trapped signal until the foreground child returns, so the long steps below run in
# the background under `wait`, which a signal interrupts at once. SIGKILL is covered by reap_stale.
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

reap_stale

echo "e2e-docker: building images (tag $worktree_tag, playwright $playwright_version)"
compose build &
wait $!

# Stamped after the build so a slow cold build never makes a live stack look stale to reap_stale;
# a --keep stack gets a name the reaper does not match at all.
run_id="$(date +%s)-$(printf '%04x%04x' "$RANDOM" "$RANDOM")"
$keep && run_id="keep-$run_id"
out_dir="$reports_dir/$run_id"
mkdir -p "$out_dir"
export VM_E2E_OUT="$out_dir"
export VM_E2E_PROJECT="$project_prefix-$run_id"

# The subnet is drawn from 11.0.0.0/8 (docker/e2e/README.md, "Why the network is on 11.x"). Two
# live stacks landing on the same /24 is a 1-in-65k event and Docker refuses the overlap: redraw.
started=false
for attempt in 1 2 3 4 5; do
  export VM_E2E_SUBNET="11.$((RANDOM % 256)).$((RANDOM % 256)).0/24"
  echo "e2e-docker: stack $VM_E2E_PROJECT on $VM_E2E_SUBNET"
  ( compose up --no-build --detach db api web fixtures 2>&1 | tee "$up_log" ) &
  if wait $!; then started=true; break; fi
  destroy_project "$VM_E2E_PROJECT"
  if grep -qi "pool overlaps" "$up_log"; then
    echo "e2e-docker: subnet taken by another network, redrawing ($attempt/5)"
    continue
  fi
  echo "e2e-docker: the stack failed to start (output above)" >&2
  exit 1
done
$started || { echo "e2e-docker: no free 11.x.y.0/24 after 5 draws; is something else using 11.0.0.0/8?" >&2; exit 1; }

set +e
compose run --rm --no-deps -T runner &
wait $!
status=$?
set -e

if [ "$status" -ne 0 ]; then
  echo; echo "e2e-docker: FAILED (exit $status). Last api / web log lines:"
  compose logs --no-color --tail 40 api web || true
fi
echo "e2e-docker: report in ${out_dir#"$root"/}"
exit "$status"
