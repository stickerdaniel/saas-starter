---
name: pair-review
description: Iterativer Plan-Review-Loop mit OpenAI Codex als zweiter Meinung. Use when the user runs /pair-review, asks for cross-model verification of a plan file in ~/.claude/plans/, or — most importantly — before calling ExitPlanMode in plan mode to validate the proposed plan with adversarial review.
allowed-tools: Bash(codex:*), Bash(timeout:*), Bash(jq:*), Bash(mkdir:*), Bash(cd:*), Bash(grep:*), Bash(head:*), Bash(tail:*), Bash(echo:*), Bash(ls:*), Bash(cat:*), Bash(pwd:*), Bash(rm:*), Read, Edit, WebSearch, Grep, Bash(btca:*)
---

# pair-review

Loop: Codex reviewt → du verifizierst → patchst Plan → Codex re-reviewt. Max 5 Iterationen. Du bist führend. Codex hat kein Project-Memory, CLAUDE.md oder Konventionen — du bringst diesen Kontext ein.

## Setup

Workdir: `/tmp/pair-review/$CLAUDE_CODE_SESSION_ID`. Clean slate: workdir komplett wipen + neu anlegen + caller_cwd persistieren (Resume braucht sie, kein `--cd`-Flag). `rm -rf <dir>` statt `rm -f <dir>/<glob>` weil zsh per default bei unmatched globs fail't (V1 Run zeigte: `(eval):1: no matches found: iter-*.md`).

Session-ID-Guard via Parameter-Substitution `${VAR:?msg}` — fail loud wenn Variable empty/unset, ohne extra `test`-Permission:

```bash
rm -rf "/tmp/pair-review/${CLAUDE_CODE_SESSION_ID:?CLAUDE_CODE_SESSION_ID required}" && \
mkdir -p "/tmp/pair-review/${CLAUDE_CODE_SESSION_ID}" && \
pwd > "/tmp/pair-review/${CLAUDE_CODE_SESSION_ID}/caller_cwd"
```

Setup ist der Single-Point-Guard: `${VAR:?msg}` failt loud wenn `CLAUDE_CODE_SESSION_ID` empty/unset. Folge-Schritte (Init, Resume, Konvergenz) nutzen die kürzere `$CLAUDE_CODE_SESSION_ID`-Form und nehmen die Setup-Vorbedingung implizit an.

Default-Plan-Pfad-Lookup wenn nicht übergeben:

```bash
ls -t ~/.claude/plans/*.md | head -1
```

## 1. Init

Setup hat bereits clean slate gemacht (`rm -rf workdir`), kein extra cleanup hier nötig.

Codex-Call: Prompt via stdin-heredoc mit `-` als arg-marker (upstream-supported pattern, siehe t3code `CodexTextGeneration.ts`). Konsistent mit Resume-Step unten. Plus `timeout`-Wrapper gegen CLI-Hangs bei Rate-Limit/Auth-Errors:

```bash
timeout 5m codex exec --cd "$(cat /tmp/pair-review/$CLAUDE_CODE_SESSION_ID/caller_cwd)" --skip-git-repo-check --json \
  -o /tmp/pair-review/$CLAUDE_CODE_SESSION_ID/iter-0.md \
  - \
  > /tmp/pair-review/$CLAUDE_CODE_SESSION_ID/iter-0.ndjson \
  2> /tmp/pair-review/$CLAUDE_CODE_SESSION_ID/iter-0.err \
  <<'PROMPT_EOF'
Review the plan at <plan-path>. Read it carefully and read any files it references in the codebase. Output format:

First line: VERDICT: <PASS|FAIL|PARTIAL>
Second line: SUMMARY: <one sentence>
Then for each finding, a block in this exact form:

## F<n> [P1|P2|P3] <category>  <file>:<line>
<description, can span multiple lines>
Suggested: <action>

No prose outside finding blocks. Empty findings list = no '## F' blocks at all.
PROMPT_EOF
```

Single-quoted `'PROMPT_EOF'` verhindert Variable-Expansion im Heredoc-Body. Claude muss `<plan-path>` durch den echten Plan-Pfad ersetzen.

**Failure-Detection** (Codex kann mit exit 0 fertig sein nach `turn.failed`-Event, z.B. bei Rate-Limit). `if`-Block gegen invertierte Exit-Codes von `jq -e`:

```bash
if jq -e 'select(.type=="turn.failed" or .type=="error")' "/tmp/pair-review/${CLAUDE_CODE_SESSION_ID:?}/iter-0.ndjson" > /dev/null; then
  echo "CODEX_FAIL — stream errors:"
  jq -c 'select(.type=="error" or .type=="turn.failed")' "/tmp/pair-review/${CLAUDE_CODE_SESSION_ID}/iter-0.ndjson" | tail -3
  cat "/tmp/pair-review/${CLAUDE_CODE_SESSION_ID}/iter-0.err"
  exit 1
fi
```

Bei Failure: STOP, nicht weiter iterieren.

**thread_id extrahieren und persistieren:**

```bash
jq -r 'select(.type=="thread.started") | .thread_id' /tmp/pair-review/$CLAUDE_CODE_SESSION_ID/iter-0.ndjson | head -1 > /tmp/pair-review/$CLAUDE_CODE_SESSION_ID/thread_id
```

Wenn `thread_id`-File leer: STOP. Sonst `iter-0.md` per `Read` laden und Findings parsen.

## 2. Verify each finding

Pro Finding: harter Real-World-Check (`Read`, `Grep`, `btca`, `WebSearch`). Verdict:

- `real` → Plan via `Edit` patchen
- `false-positive` → file:line, Doku-Zitat, oder andere harte Evidenz
- `accept-out-of-scope` → kurze Begründung

NIE patchen ohne Verification. NIE für Codex' Zufriedenheit nachgeben.

## 3. Resume

Fülle `templates/verification-summary.md` mit aktuellen Iterations-Daten. `codex exec resume` kennt kein `--cd`, daher `cd && codex` (Compound-Permission greift). Vorher stale `iter-N.md` löschen (N = aktuelle Iteration, 1-basiert):

```bash
rm -f /tmp/pair-review/$CLAUDE_CODE_SESSION_ID/iter-N.md && \
cd "$(cat /tmp/pair-review/$CLAUDE_CODE_SESSION_ID/caller_cwd)" && \
timeout 5m codex exec resume "$(cat /tmp/pair-review/$CLAUDE_CODE_SESSION_ID/thread_id)" --skip-git-repo-check --json \
  -o /tmp/pair-review/$CLAUDE_CODE_SESSION_ID/iter-N.md \
  - <<'PAIR_REVIEW_EOF' \
  > /tmp/pair-review/$CLAUDE_CODE_SESSION_ID/iter-N.ndjson \
  2> /tmp/pair-review/$CLAUDE_CODE_SESSION_ID/iter-N.err
{gefüllter Template-Inhalt}
PAIR_REVIEW_EOF
```

Single-quoted `'PAIR_REVIEW_EOF'` verhindert Variable-Expansion im Heredoc-Body.

**Failure-Detection danach:** identischer `if`-Block wie bei Init (gegen `iter-N.ndjson` statt `iter-0.ndjson`), STOP bei Match.

## 4. Konvergenz

Strenger Check: erste Zeile MUSS exakt `VERDICT: PASS` sein UND keine `## F`-Finding-Blöcke vorhanden:

```bash
# PASS-Check (strict)
[ "$(head -1 /tmp/pair-review/$CLAUDE_CODE_SESSION_ID/iter-N.md)" = "VERDICT: PASS" ] && \
  ! grep -q '^## F' /tmp/pair-review/$CLAUDE_CODE_SESSION_ID/iter-N.md && \
  echo CONVERGED_PASS

# PARTIAL-Check
[ "$(head -1 /tmp/pair-review/$CLAUDE_CODE_SESSION_ID/iter-N.md)" = "VERDICT: PARTIAL" ] && \
  echo CHECK_PARTIAL_FINDINGS
```

Bei `CHECK_PARTIAL_FINDINGS`: lies `iter-N.md`, prüfe ob alle remaining `## F`-Blöcke `[P3]` haben oder vorher als `accept-out-of-scope` markiert wurden — dann DONE.

- `CONVERGED_PASS` → **DONE**
- `PARTIAL` mit nur P3/accept-out-of-scope → **DONE**
- Iteration 5 mit offenen P1/P2 → Eskalation: pro Finding Codex' Argument vs. deine Verteidigung, User entscheidet
- Sonst → goto 2

Bei DONE: ein Satz Bericht ("konvergiert nach N Iterationen, PASS") + 1-3 Bullets mit Plan-Änderungen. Wenn in plan mode: `ExitPlanMode`.
