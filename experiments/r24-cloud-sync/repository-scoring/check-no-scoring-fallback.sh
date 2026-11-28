#!/usr/bin/env bash
# Static companion to assignment-evaluation.test.mjs and worker.test.mjs.
set -euo pipefail
cd "$(dirname "$0")/../../.."
base=experiments/r24-cloud-sync
scoring="$base/repository-scoring"
api="$base/backend/api.mjs"
sources=("$scoring/run.mjs" "$scoring/worker.mjs" "$scoring/queue.mjs" "$scoring/archive.mjs" "$base/backend/evaluation-schema.mjs" "$base/cloudbase/repository-notifier.mjs")
pattern='hy3|hunyuan|混元|@cloudbase|cloudbase[/_]|ai-draft-provider|ai-gateway-client|ai_gateway|fallback|reserve_ai_draft|generateText|evaluationGeneration'
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Preserve grep I/O and regex errors. Only exit 1 means a successful empty search.
scan() {
  local result=0
  rg --no-heading --color never "$@" || result=$?
  if (( result > 1 )); then return "$result"; fi
}

printf 'New evaluation runtime (entire files, including all catch branches)\n'
printf '  %s\n' "${sources[@]}"
printf 'rg -nHi -- %s\n' "$pattern"
scan -nHi -- "$pattern" "${sources[@]}" > "$work/runtime"
cat "$work/runtime"

# Accept only three exact lines that decode existing model/source metadata. A new
# provider name, import or call in any other context, including a catch, fails.
while IFS= read -r hit; do
  file=${hit%%:*}
  numbered=${hit#*:}
  line=${numbered#*:}
  case "$file:$line" in
    "$scoring/worker.mjs:const modelIds = new Set([model, 'gpt-4o-mini', 'gpt-4o', 'hy3', 'hy3-preview']);") ;;
    "$scoring/worker.mjs:    (['openai_gateway','cloudbase_hunyuan','openai_offline'].includes(raw.source) ? raw.source : null);") ;;
    "$scoring/archive.mjs:const originalSubmissionModels = new Set(['hy3', 'hy3-preview', ...historicalOpenAIModels, currentReviewModel]);") ;;
    *) printf 'Unexpected scoring provider or fallback reference: %s\n' "$hit" >&2; exit 1 ;;
  esac
done < "$work/runtime"

# The independent manual button remains available for assignments outside the
# rollout. Automatic submission/polling paths must never call that button.
browserPattern='/evaluate|evaluateAssignment|assignmentsEvaluate|requestEvaluation|\.evaluate\s*\(|evaluateReview|createHunyuanClient|generateText|api\.openai\.com|reserve_ai_draft'
scan -Hi -g '*.js' -g '*.mjs' -g '*.py' -- "$browserPattern" "$base/overlay/" "$base/stage-site.py" | sort > "$work/browser"
cat > "$work/allowed-browser" <<EOF
$base/overlay/app.js:async function evaluateReview(){
$base/overlay/app.js:  const response=await assignmentSync.evaluate(cloudSubmissionPayload(snap));
$base/overlay/app.js:  ELEM('reviewAiEvaluate').onclick=()=>void evaluateReview();
$base/overlay/assignment-sync.mjs:    evaluate: snapshot => get('/assignments/evaluate', 'POST', {snapshot}, 95_000),
EOF
sort "$work/allowed-browser" | diff -u - "$work/browser"

# Only an explicit manual request with a confirmed negative eligibility result
# may reach the synchronous provider. Missing eligibility must not select it.
guard='  if (eligible === false) return generateLegacyEvaluation(dependencies, principal, snapshot.assignmentId, id, items);'
sed -n '/^async function readLegacyEvaluation(/,/^}/p' "$api" > "$work/manual"
rg -q -F 'const eligible = await store.canAutoScore?.(snapshot.assignmentId, principal);' "$work/manual"
rg -q -xF "$guard" "$work/manual"
rg -q -F 'AI_EVALUATION_AFTER_SUBMIT' "$work/manual"
scan -F 'generateLegacyEvaluation(' "$api" | rg -v '^async function generateLegacyEvaluation\(' > "$work/calls"
printf '%s\n' "$guard" | diff -u - "$work/calls"

sed -n -e '/^async function historicalEvaluation(/,/^}/p' -e '/^async function submit(/,/^}/p' "$api" > "$work/submit"
rg -q -F 'store.getEvaluation(id)' "$work/submit"
rg -q -F 'historicalEvaluation(store, expectedId, principal, assignmentId)' "$work/submit"
scan -ni -- "$pattern|generateLegacyEvaluation|fetch\(|\.generate\(|\.evaluate\(|reserve\(" "$work/submit" > "$work/submit-calls"
if [[ -s "$work/submit-calls" ]]; then cat "$work/submit-calls"; exit 1; fi
rg -nF "const endpoint = 'https://api.openai.com/v1/chat/completions'" "$scoring/worker.mjs"
rg -nF 'createOpenAIScorer(env.OPENAI_API_KEY)' "$scoring/run.mjs"
printf 'PASS. Automatic submissions use the repository worker. Only explicitly manual, non-enrolled work can call the legacy provider.\n'
