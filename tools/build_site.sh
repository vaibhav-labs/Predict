#!/bin/sh
# Assemble the static site that GitHub Pages serves: app/ plus the data tables it reads.
# Run from anywhere:  sh tools/build_site.sh
# The workflow in .github/workflows/pages.yml runs this on every push to main.
set -e
cd "$(dirname "$0")/.."
B="${BUILD_ID:-$(git rev-parse --short HEAD 2>/dev/null || echo dev)}"
rm -rf site
mkdir -p site/data
cp -R app/. site/
cp data/scoring.json data/*.csv site/data/
# Stamp the build id into the service worker (new cache name per deploy), the page and the app's own build.js.
for f in sw.js index.html js/build.js; do
  sed "s/__BUILD__/$B/g" "app/$f" > "site/$f"
done
# List every file the app needs offline. The service worker reads this list when it installs.
python3 - <<'PY'
import json, os
root, skip, files = "site", {"sw.js", "precache.json"}, []
for d, _, names in os.walk(root):
    for n in names:
        p = os.path.relpath(os.path.join(d, n), root).replace(os.sep, "/")
        if p not in skip and not n.startswith("LICENSE"):
            files.append(p)
json.dump(sorted(files), open(os.path.join(root, "precache.json"), "w"))
PY
# A file that still carries the placeholder would ship a broken cache name: stop here instead.
if grep -rq "__BUILD__" site; then
  echo "site/ still contains __BUILD__: add that file to the stamping loop in tools/build_site.sh" >&2
  exit 1
fi
echo "site/ ready, build $B"
