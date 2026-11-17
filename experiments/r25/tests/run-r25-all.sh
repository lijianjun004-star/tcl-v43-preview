#!/usr/bin/env bash
# R2.5 全量复跑：Node 回归（迁移+新增）、Python 浏览器回归、真实 Vosk 链路场景（含 R24 对照）。
# 用法：run-r25-all.sh <仓库式根目录(含 experiments/r25)> <R24站点根(含 tcl-v352-asr-r24-qa)> <结果目录> <合成语音wav目录>
set -u
ROOT=$1; R24SITE=$2; OUT=$3; AUD=$4
PY=${PYTHON:-python3}; mkdir -p "$OUT/logs" "$OUT/flows" "$OUT/shots"
# Optional controlled external test dependency directory (no install or repository mutation).
export NODE_PATH=${R25_TEST_NODE_PATH:-${NODE_PATH:-$(npm root -g)}}
T=$ROOT/experiments/r25/tests; SITE=$ROOT/experiments/r25
summary=()
rec(){ summary+=("$1|$2|$3"); echo "$1 => $2 $3"; }
cd "$ROOT"
if [[ -z ${ONLY_FLOWS:-} ]]; then
for t in "$T"/*.cjs "$T"/*.mjs; do
  b=$(basename "$t"); [[ $b == r25-flow.cjs ]] && continue
  if [[ $b == name-identity.mjs || $b == name-login-ui.cjs ]]; then
    rec "node:$b" SUPERSEDED "Direct role/no-invite contract: direct-registration-identity.mjs, direct-registration-workflow.mjs, direct-registration-ui.py; historical invite-only checks not run or counted PASS"
    continue
  fi
  if [[ $b == r25-bridge-release.mjs || $b == bridge-worker.mjs || $b == bridge-delivery.mjs || $b == app-queue-wakeup.mjs || $b == audio-locks.mjs ]]; then timeout 300 node --test "$t" >"$OUT/logs/$b.log" 2>&1; else timeout 300 node "$t" >"$OUT/logs/$b.log" 2>&1; fi
  c=$?; scope="MOCK"; [[ $b == direct-registration-acl.mjs ]] && scope="Actual in-memory PGlite/RLS; synthetic Auth and Storage metadata, no cloud writes"
  rec "node:$b" $([ $c = 0 ] && echo PASS || echo FAIL) "exit=$c ($scope)"
done
timeout 300 node --test "$ROOT/backend/r25-name-identity/tests/direct-registration.test.cjs" >"$OUT/logs/direct-registration-backend.log" 2>&1
c=$?; rec "backend:direct-registration.test.cjs" $([ $c = 0 ] && echo PASS || echo FAIL) "exit=$c (in-memory PGlite, synthetic Auth; NODE_PATH-controlled dependencies, no cloud writes)"
for t in direct-registration-ui.py record-cache.py session_concurrency.py session_smooth_recovery.py browser_smooth_e2e.py; do
  timeout 900 $PY -I "$T/$t" >"$OUT/logs/$t.log" 2>&1; c=$?; rec "browser:$t" $([ $c = 0 ] && echo PASS || echo FAIL) "exit=$c (Chromium, synthetic data, Whisper mocked)"
done
fi
flow(){ # id site sub engine mode voskpre audio rec_ms expectFilled [multi]
  local id=$1; [[ -n ${FLOW_FILTER:-} && ! $id =~ $FLOW_FILTER ]] && return 0; SHOT="$OUT/shots/$id" SITE=$2 SUB=$3 ENGINE=$4 MODE=$5 VOSKPRE=$6 AUDIO=$7 REC_MS=$8 MULTI=${10:-} OUT="$OUT/flows/$id.json" \
    timeout 600 node "$T/r25-flow.cjs" >/dev/null 2>&1
  local got=$(node -e "const d=require('$OUT/flows/$id.json');const n=(d.questions||[]).filter(q=>q.answer.trim()).length;console.log(d.interrupted?'INTERRUPTED':String(d.answerFilled)+(d.questions?' q='+n+'/'+d.questions.length:'')+' trad='+d.answerHasTraditional+' ext='+JSON.stringify(d.externalRequests)+' err='+d.pageErrors.length)" 2>/dev/null || echo NO_RESULT)
  local ok=FAIL; [[ $got == $9* && $got != *trad=true* && $got == *err=0 ]] && ok=PASS
  [[ -n ${10:-} && $got != *q=3/3* ]] && ok=FAIL
  [[ $id == R24-* && $ok == PASS ]] && ok=BUG_REPRODUCED
  rec "flow:$id" $ok "$got (REAL Vosk model + espeak-ng synthetic Mandarin; external hosts blocked locally)"
}
S25=tcl-v352-asr-r25-qa; S24=tcl-v352-asr-r24-qa
flow R25-V1-default-vosk        "$SITE"   $S25 ''   abort none  "$AUD/q1pad.wav" 11000 true
flow R25-WA-base-hostfail       "$SITE"   $S25 base abort none  "$AUD/q1pad.wav" 11000 true
flow R25-WB-base-hosthang       "$SITE"   $S25 base hang  none  "$AUD/q1pad.wav" 11000 true
flow R25-WD-base-hang-voskready "$SITE"   $S25 base hang  ready "$AUD/q1pad.wav" 11000 true
flow R25-M3-three-questions     "$SITE"   $S25 ''   abort none  "$AUD/q2pad.wav" 13000 true 1
flow R24-A-hostfail             "$R24SITE" $S24 ''  abort none  "$AUD/q1pad.wav" 11000 false
flow R24-B-hosthang             "$R24SITE" $S24 ''  hang  none  "$AUD/q1pad.wav" 11000 false
flow R24-D-hang-voskready       "$R24SITE" $S24 ''  hang  ready "$AUD/q1pad.wav" 11000 false
printf '%s\n' "${summary[@]}" >> "$OUT/SUMMARY.txt"
echo "R25: $(grep -v '^flow:R24' "$OUT/SUMMARY.txt" | grep -c '|PASS|')/$(grep -v '^flow:R24' "$OUT/SUMMARY.txt" | grep -vc '|SUPERSEDED|') PASS; R24 baseline: $(grep -c 'BUG_REPRODUCED' "$OUT/SUMMARY.txt")/3 defect reproduced"
