#!/bin/bash
# Publish a verified Packages build, including recovery after a release failure.
set -euo pipefail
: "${GH_REPO:?}" "${GH_TOKEN:?}"

run_id=${BUILD_RUN_ID:-}
if [[ -z "$run_id" ]]; then
    run_id=$(gh api "repos/$GH_REPO/actions/workflows/packages.yml/runs?status=completed&event=push&per_page=20" \
        --jq '[.workflow_runs[] | select(.head_branch == "main")][0].id')
fi
[[ "$run_id" =~ ^[0-9]+$ ]] || { echo "No completed package build found" >&2; exit 1; }
gh api "repos/$GH_REPO/actions/runs/$run_id" > build-run.json
build_sha=$(python3 - <<'PY'
import json, os, re
r = json.load(open('build-run.json'))
assert r['repository']['full_name'] == os.environ['GH_REPO']
assert r['head_repository']['full_name'] == os.environ['GH_REPO']
assert r['path'] == '.github/workflows/packages.yml'
assert r['event'] in ('push', 'workflow_dispatch')
assert r['head_branch'] == 'main' or r['head_branch'].startswith('v')
assert re.fullmatch('[0-9a-f]{40}', r['head_sha'])
print(r['head_sha'])
PY
)
result=$(gh api "repos/$GH_REPO/actions/runs/$run_id/jobs?filter=latest" \
    --jq '[.jobs[] | select(.name == "build")][0].conclusion')
[[ "$result" == success ]] || { echo "The package build did not pass" >&2; exit 1; }
gh run download "$run_id" --name sailfish-gnome-5.1.0.11-aarch64 --dir out
(cd out && sha256sum -c SHA256SUMS)
export BUILD_SHA="$build_sha"
version=$(python3 - <<'PY'
import json, os, re
info = json.load(open('out/BUILDINFO.json'))
assert info['commit'] == os.environ['BUILD_SHA']
assert info['sailfish_release'] == '5.1.0.11' and info['architecture'] == 'aarch64'
assert re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', info['version'])
print(info['version'])
PY
)

# GITHUB_TOKEN cannot create a tag at an older commit whose workflows differ
# from the default branch. Use current main only when every package source,
# recipe and build script still matches the successful build. BUILDINFO keeps
# the exact commit that produced the binaries; website/publisher edits may vary.
git fetch origin main "$build_sha"
target=$(git rev-parse origin/main)
git diff --exit-code "$build_sha" "$target" -- \
    rpm scripts vapi tests/consumer sources.lock COPYING
tag="v$version"
if gh release view "$tag" --json isDraft > release.json 2>/dev/null; then
    if [[ $(python3 -c 'import json; print(json.load(open("release.json"))["isDraft"])') != True ]]; then
        echo "Release $tag already exists; published assets are never replaced."
        exit 0
    fi
    git fetch origin "refs/tags/$tag:refs/tags/$tag"
    git diff --exit-code "$build_sha" "$tag" -- rpm scripts vapi tests/consumer sources.lock COPYING
    gh release upload "$tag" out/* --clobber
else
    gh release create "$tag" out/* --draft --target "$target" \
        --title "Sailfish GNOME $version · Sailfish OS 5.1.0.11 / aarch64" \
        --notes-file RELEASE-NOTES.md
fi
# Keep a partial upload private. A failed upload can resume from the same build.
gh release edit "$tag" --draft=false
