#!/bin/bash
# Rename the project's product name everywhere it appears in code/docs, in one shot.
#
# Usage:
#   scripts/rename-project.sh "NewName"                 # rename only (safe, no push)
#   scripts/rename-project.sh "NewName" --push           # rename, commit, and push
#   scripts/rename-project.sh "NewName" --push --rename-repo   # also renames the GitHub repo (gh CLI, high blast radius)
#
# What this touches:
#   - The 4 runtime-visible UI/persona strings (main menu header, wordmark, welcome
#     text, AI system-prompt persona)
#   - Every other "Checkpoint" mention in Assets/Scripts (comments only — excludes
#     Assets/Scripts/Leaf/, whose class *names* double as their *file* names; a blind
#     text rename there would desync imports from filenames and break the build)
#   - README.md
#
# What this deliberately does NOT touch:
#   - Assets/Scripts/Leaf/** (LEAF test scenario class/file names — rename manually
#     with `git mv` + import fixups if you actually want this, it's a bigger refactor)
#   - supabase/migrations/**.sql (applied migrations are historical record, not live config)
#   - CLAD_PROMPT_LOG.md (historical build log — renaming past entries would be revisionist)
#   - Lens Studio's own internal Lens name (CLADWeek3.esproj's `lensName` field, shown
#     in the Project Info panel / Lens Studio title bar). There's no CLI for this — it's
#     set via the Lens Studio Editor API (Editor.Model.MetaInfo.lensName) or by hand in
#     the Project Info panel inside the app. Ask Claude to run it, or set it yourself:
#     Project Info panel → Lens Name field.

set -euo pipefail
cd "$(dirname "$0")/.."

NEW_NAME="${1:-}"
if [ -z "$NEW_NAME" ]; then
  echo "Usage: $0 \"NewName\" [--push] [--rename-repo]" >&2
  exit 1
fi
shift || true

DO_PUSH=false
DO_REPO_RENAME=false
for arg in "$@"; do
  case "$arg" in
    --push) DO_PUSH=true ;;
    --rename-repo) DO_REPO_RENAME=true ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

OLD_NAME="Checkpoint"
NEW_UPPER=$(echo "$NEW_NAME" | tr '[:lower:]' '[:upper:]')

echo "Renaming '$OLD_NAME' -> '$NEW_NAME' (wordmark: '$NEW_UPPER')"

# --- Targeted runtime-visible strings ---
sed -i '' "s/this.headerText.text = '${OLD_NAME}'/this.headerText.text = '${NEW_NAME}'/" \
  Assets/Scripts/Shared/MainMenu.ts

sed -i '' "s/t.text = 'CHECKPOINT'/t.text = '${NEW_UPPER}'/" \
  Assets/Scripts/Shared/ThemedUI.ts

# Internal (non-user-visible) runtime scene-object name — not caught by the word-boundary
# pass below since "CheckpointLogo" is one token, not "Checkpoint" + a boundary.
sed -i '' "s/createSceneObject('${OLD_NAME}Logo')/createSceneObject('${NEW_NAME}Logo')/" \
  Assets/Scripts/Shared/ThemedUI.ts

sed -i '' "s/Welcome to ${OLD_NAME}/Welcome to ${NEW_NAME}/" \
  Assets/Scripts/Shared/NameEntryPanel.ts

sed -i '' "s/You are ${OLD_NAME}, an assistant/You are ${NEW_NAME}, an assistant/" \
  Assets/Scripts/Session/SessionSummarizer.ts

# --- Comment-only mentions elsewhere in Assets/Scripts (excluding Leaf/) ---
# NOTE: [[:<:]]/[[:>:]] are BSD sed's word-boundary syntax (macOS ships BSD sed, which
# does not understand \b at all — it silently no-ops instead of erroring, so this was
# tested explicitly rather than assumed).
for f in $(git grep -l "$OLD_NAME" -- 'Assets/Scripts/*' ':!Assets/Scripts/Leaf/*' 2>/dev/null || true); do
  sed -i '' "s/[[:<:]]${OLD_NAME}[[:>:]]/${NEW_NAME}/g" "$f"
done

# --- README ---
if [ -f README.md ]; then
  sed -i '' "s/[[:<:]]${OLD_NAME}[[:>:]]/${NEW_NAME}/g" README.md
fi

echo ""
echo "Text rename done. Verifying TypeScript still compiles is your job (or ask Claude"
echo "to run RecompileTypeScriptTool) before committing if you're not already in Lens Studio."
echo ""
echo "NOTE: Lens Studio's internal Lens name is unchanged — ask Claude to set it via the"
echo "Editor API, or set it yourself in Lens Studio's Project Info panel."

git add -A
if git diff --cached --quiet; then
  echo "Nothing changed — is the project already named '$NEW_NAME'?"
  exit 0
fi

git commit -m "Rename project to ${NEW_NAME}"
echo "Committed."

if [ "$DO_REPO_RENAME" = true ]; then
  if command -v gh >/dev/null 2>&1; then
    echo "Renaming GitHub repo to '${NEW_NAME}'..."
    gh repo rename "$NEW_NAME" --yes
  else
    echo "gh CLI not found — skipping GitHub repo rename. Install gh or rename manually on github.com." >&2
  fi
fi

if [ "$DO_PUSH" = true ]; then
  git push
  echo "Pushed."
else
  echo "Not pushed (pass --push to push automatically, or run 'git push' yourself)."
fi
