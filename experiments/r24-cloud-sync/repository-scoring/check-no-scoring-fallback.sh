#!/usr/bin/env bash
# Static companion to assignment-evaluation.test.mjs and worker.test.mjs.
set -euo pipefail
cd "$(dirname "$0")/../../.."
base=experiments/r24-cloud-sync
scoring="$base/repository-scoring"
api="$base/backend/api.mjs"
native="$base/cloudbase/ai-draft-provider.mjs"
wiring="$base/cloudbase/function.mjs"
adapter="$base/backend/ai-gateway-client.mjs"
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

printf '\nBrowser overlay and packager. Reject direct scoring triggers, even from error handlers.\n'
printf '  %s\n' "$base/overlay/" "$base/stage-site.py"
browserPattern='/evaluate|evaluateAssignment|assignmentsEvaluate|requestEvaluation|\.evaluate\s*\(|createHunyuanClient|generateText|api\.openai\.com|reserve_ai_draft'
printf 'rg -nHi -- %s\n' "$browserPattern"
scan -nHi -g '*.js' -g '*.mjs' -g '*.py' -- "$browserPattern" "$base/overlay/" "$base/stage-site.py" > "$work/browser"
if [[ -s "$work/browser" ]]; then cat "$work/browser"; exit 1; fi
printf 'No direct browser scoring trigger. Retained history labels, read and display sites:\n'
scan -nH -- 'cloudbase_hunyuan|hy3|mySubmissions:|evaluationReadbackHtml\(|if \(existing\) return|submitted\.evaluationId === id|AI_EVALUATION_ALREADY_SUBMITTED|AI_EVALUATION_AFTER_SUBMIT' "$base/overlay/ai-model-label.mjs" "$base/overlay/assignment-sync.mjs" "$base/overlay/assignment-evaluation.mjs" "$api"

printf '\nJob failure and no-retry branches\n'
scan -nH -- 'catch|needs_model|await score\(|await queue\.startAttempt' "$scoring/run.mjs" "$scoring/worker.mjs" "$scoring/archive.mjs"
printf '\nSynchronous evaluation route, cloud composition and Hunyuan draft adapter\n'
scan -nH -- '/assignments/evaluate|readLegacyEvaluation|createCloudBaseDraftGeneration|draftGeneration|createHunyuanClient|_reserve_ai_draft|generateText|return \{model: configuredModel, source, generate' "$api" "$native" "$wiring" "$adapter"
scan -nHi -- 'createCloudBaseEvaluationGeneration|evaluationGeneration|\.evaluate\s*\(' "$api" "$native" "$wiring" > "$work/wiring"
if [[ -s "$work/wiring" ]]; then cat "$work/wiring"; exit 1; fi

# Inspect the complete body of the legacy route separately from the permitted
# operator draft path in the same API module. Refuse a missing or renamed body.
sed -n '/^async function readLegacyEvaluation(/,/^}/p' "$api" > "$work/legacy"
rg -q -F 'AI_EVALUATION_AFTER_SUBMIT' "$work/legacy"
scan -ni -- "$pattern|fetch\(|\.generate\(|\.evaluate\(|reserve\(" "$work/legacy" > "$work/legacy-calls"
if [[ -s "$work/legacy-calls" ]]; then cat "$work/legacy-calls"; exit 1; fi
rg -nF "const endpoint = 'https://api.openai.com/v1/chat/completions'" "$scoring/worker.mjs"
rg -nF 'createOpenAIScorer(env.OPENAI_API_KEY)' "$scoring/run.mjs"
printf 'PASS. The legacy handler reads history. New scores use the repository worker. Draft-only matches are listed above.\n'
