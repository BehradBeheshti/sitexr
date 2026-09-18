#!/usr/bin/env bash
# Installs a pre-commit hook that refuses to commit licensed or client-owned assets.
# Git hooks are not part of a clone, so each checkout runs this once:
#
#   bash tools/install-hooks.sh
set -euo pipefail
cd "$(dirname "$0")/.."
hook=.git/hooks/pre-commit
cat > "$hook" <<'HOOK'
#!/usr/bin/env bash
# Refuse to commit model formats and anything under public/private/. This repository is
# public; its history is permanent, and a file deleted later is still in every clone.
staged=$(git diff --cached --name-only --diff-filter=A)
blocked=$(echo "$staged" | grep -E '(^public/private/|\.(ifc|rvt|rte)$)' || true)
if [ -n "$blocked" ]; then
    echo "refusing to commit licensed or client-owned assets:" >&2
    echo "$blocked" | sed 's/^/  /' >&2
    echo >&2
    echo "Serve them from public/private/ locally, or from the bucket named by" >&2
    echo "VITE_ASSET_BASE. To override deliberately: git commit --no-verify" >&2
    exit 1
fi
HOOK
chmod +x "$hook"
echo "installed $hook"
