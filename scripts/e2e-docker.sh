#!/usr/bin/env bash
# Full-stack e2e in Docker: db + api (the Render image) + web (production build) + fixture pages
# + a Playwright runner, all inside one private network.
#
#   scripts/e2e-docker.sh            run the suite against a brand-new stack, then destroy it
#   scripts/e2e-docker.sh --keep     same, but leave the stack up for debugging (prints how to reach it)
#   scripts/e2e-docker.sh prune      destroy every stack and image this worktree ever created
#   scripts/e2e-docker.sh prune-all  destroy every vm-e2e stack and image on this machine
#
# Isolation: every invocation creates its own compose project (`vm-e2e-<worktree>-<run>`), its own
# network and its own throwaway database, publishes no host ports and names no containers, so any
# number of worktrees / agents can run this at the same time. Images are tagged per worktree, so
# one branch's build never replaces the image another branch is testing, while a re-run in the
# same worktree reuses its layers.
#
# Exit code is Playwright's. The HTML report and traces land in apps/web/playwright-report-docker/.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
compose_file="$root/docker/e2e/compose.yml"

hash_of() { printf '%s' "$1" | cksum | cut -d' ' -f1; }

# Stable per checkout path: the primary checkout and each .worktrees/<branch> get different tags.
worktree_tag="$(basename "$root" | tr -c 'a-zA-Z0-9\n' '-' | tr 'A-Z' 'a-z' | cut -c1-24)-$(printf '%08x' "$(hash_of "$root")")"
project_prefix="vm-e2e-${worktree_tag}"

command -v docker >/dev/null || { echo "e2e-docker: docker is not installed or not on PATH" >&2; exit 2; }
docker info >/dev/null 2>&1 || { echo "e2e-docker: the Docker daemon is not running" >&2; exit 2; }

destroy_projects() { # $1 = project name prefix
  local p
  for p in $(docker compose ls --all --quiet 2>/dev/null | grep -E "^$1" || true); do
    echo "e2e-docker: removing stack $p"
    docker compose --project-name "$p" down --volumes --remove-orphans --timeout 5 >/dev/null 2>&1 || true
  done
}

destroy_images() { # $1 = tag glob
  local images
  images="$(docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -E "^vm-e2e-(api|web|runner):$1" || true)"
  [ -z "$images" ] || { echo "$images" | xargs docker image rm --force >/dev/null; echo "e2e-docker: removed $(echo "$images" | wc -l | tr -d ' ') image(s)"; }
}

case "${1:-run}" in
  prune)     destroy_projects "$project_prefix-"; destroy_images "$worktree_tag\$"; exit 0 ;;
  prune-all) destroy_projects "vm-e2e-";          destroy_images ".*";             exit 0 ;;
  run|--keep) ;;
  *) echo "usage: scripts/e2e-docker.sh [--keep | prune | prune-all]" >&2; exit 2 ;;
esac
keep=false; [ "${1:-}" = "--keep" ] && keep=true

# The runner image's browsers are tied to the @playwright/test version: read it, never hardcode it.
playwright_version="$(sed -n "s/^  '@playwright\/test@\([0-9][^']*\)':\$/\1/p" "$root/pnpm-lock.yaml" | head -1)"
[ -n "$playwright_version" ] || { echo "e2e-docker: could not read the @playwright/test version from pnpm-lock.yaml" >&2; exit 2; }

out_dir="$root/apps/web/playwright-report-docker"
rm -rf "$out_dir"; mkdir -p "$out_dir"

export VM_E2E_TAG="$worktree_tag"
export VM_E2E_PLAYWRIGHT_VERSION="$playwright_version"
export VM_E2E_OUT="$out_dir"
export DOCKER_BUILDKIT=1

compose() { docker compose --file "$compose_file" --project-name "$VM_E2E_PROJECT" "$@"; }

cleanup() {
  if $keep; then
    echo
    echo "e2e-docker: --keep: stack $VM_E2E_PROJECT is still up."
    echo "  logs:   docker compose -p $VM_E2E_PROJECT logs -f api web"
    echo "  shell:  docker compose -p $VM_E2E_PROJECT run --rm runner bash"
    echo "  remove: scripts/e2e-docker.sh prune"
    return
  fi
  compose down --volumes --remove-orphans --timeout 5 >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Build once, outside the retry loop. Images are per worktree, not per run.
export VM_E2E_PROJECT="$project_prefix-build" VM_E2E_SUBNET="11.0.0.0/24"
echo "e2e-docker: building images (tag $worktree_tag, playwright $playwright_version)"
compose build

# A new stack per run. The subnet is drawn from 11.0.0.0/8 (see docker/e2e/README.md); two stacks
# landing on the same /24 is a 1-in-65k event, and Docker refuses the overlap, so just redraw.
status=1
for attempt in 1 2 3 4 5; do
  run_id="$(printf '%04x%04x' "$RANDOM" "$RANDOM")"
  export VM_E2E_PROJECT="$project_prefix-$run_id"
  export VM_E2E_SUBNET="11.$((RANDOM % 256)).$((RANDOM % 256)).0/24"
  echo "e2e-docker: stack $VM_E2E_PROJECT on $VM_E2E_SUBNET"

  if ! network_error="$(compose up --no-build --detach db api web fixtures 2>&1)"; then
    compose down --volumes --remove-orphans --timeout 5 >/dev/null 2>&1 || true
    if echo "$network_error" | grep -qi "pool overlaps"; then
      echo "e2e-docker: subnet taken by another stack, redrawing ($attempt/5)"
      continue
    fi
    echo "$network_error" >&2
    exit 1
  fi

  set +e
  compose run --rm --no-deps runner
  status=$?
  set -e

  if [ "$status" -ne 0 ]; then
    echo; echo "e2e-docker: FAILED (exit $status). Last api / web log lines:"
    compose logs --no-color --tail 40 api web || true
  fi
  break
done

echo "e2e-docker: report in ${out_dir#"$root"/}"
exit "$status"
