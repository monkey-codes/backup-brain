set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <iterations>"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for ((i=1; i<=$1; i++)); do
  echo "Iteration $i"
  echo "--------------------------------"

  ISSUES=$(gh issue list --state open --json number,title,body,comments --limit 100)
  RALPH_COMMITS=$(git log --grep="RALPH" -n 10 --format="%H %ad %s" --date=short 2>/dev/null || echo "None")

  result=$(echo "## Open GitHub Issues

$ISSUES

## Recent RALPH Commits

$RALPH_COMMITS" | claude -p --dangerously-skip-permissions \
    "$(cat "$SCRIPT_DIR/ralph-prompt.md") \
Read the open GitHub issues from stdin. \
Pick the most important issue, work on it, commit, and close the issue when done. \
ONLY WORK ON A SINGLE ISSUE.")

  echo "$result"

  if [[ "$result" == *"<promise>COMPLETE</promise>"* ]]; then
    echo "All issues complete, exiting."
    exit 0
  fi
done
