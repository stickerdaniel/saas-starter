# Recipe: Optimize the support agent's prompt from your resolved tickets

Kai, the support agent (`src/lib/convex/support/agent.ts`), ships with a hand-written
system prompt. Once your fork has accumulated real support history, you can do better than
hand-tuning: optimize that prompt against the tickets you actually resolved, so new replies
look like the answers that closed threads.

This is an extension path, not a built-in feature. The template deliberately does not carry
`@ax-llm/ax` or any optimizer. This recipe is the lightweight alternative: copy a small,
self-contained piece into your fork when you have the corpus for it.

## When this is worth doing

You need an accumulated corpus first. This is not a day-one feature. It pays off once you
have on the order of dozens to low hundreds of `supportThreads` with `status: 'done'`, each
holding a real user question and a real resolution. With a handful of threads there is
nothing to learn from, and the optimizer will just echo your seed prompt back. Wait until
the history exists.

## The corpus: your resolved threads

The source of truth is already in your database. Query `supportThreads` where
`status === 'done'` (the `by_status_and_assigned` index covers a status-prefixed scan), then
read each thread's messages from the agent component the same way `support/messages.ts` does.

From each done thread, build one training example:

- **input** = the user's question (the opening user turn, plus enough following context to
  make the ask unambiguous).
- **gold** = the resolution that actually closed the thread. That is the assistant or admin
  reply the user accepted before the thread went to `done`, not a synthetic ideal answer. The
  whole point is to learn from replies that worked in production.

Drop threads that closed without a real answer (spam, duplicates, "nevermind", auto-closed
stale threads). A noisy gold answer teaches the optimizer the wrong target.

## The metric: closeness to the gold resolution

This is where support optimization differs from voice mimicry, and it is the one thing not to
copy verbatim from the reference.

The voice optimizer scores a draft with an adversarial **spot-the-AI** discriminator: a jury
tries to tell the model's draft apart from the human's real text, and indistinguishability is
the reward. That metric fits human-voice mimicry. It is wrong for support. A support reply
should be **correct, helpful, and on-brand**, and you do not care whether a reader can tell a
human or the agent wrote it.

So replace the discriminator with a **closeness-to-gold judge**. For a candidate reply to the
ticket's question, ask an LLM judge to score it against the gold resolution on:

- **correctness**: does it give the same answer / resolution as the gold, or contradict it?
- **helpfulness**: does it actually resolve the user's ask, with the right next step?
- **on-brand**: does it match the product's tone and the support style (concise, friendly,
  the WhatsApp-style brevity Kai's instructions call for)?

Fold those into one scalar the optimizer maximizes. Keep the floor idea from the reference:
an off-brand or unhelpful reply should be damped to near-zero even if it happens to overlap
the gold wording, so the optimizer is never rewarded for surface-matching a bad answer. A
small lexical-overlap term against the gold is a cheap, judge-independent sanity signal, but
the LLM judge carries the weight.

## The approach: a GEPA run in a `'use node'` action

Wrap the optimization in a Convex `'use node'` action (it needs the Node runtime for
`@ax-llm/ax` and `p-limit`). The shape mirrors `optimizeChannel` in the reference:

1. Synthesize a seed instruction from a sample of resolved tickets (or just start from the
   current `SUPPORT_AGENT_INSTRUCTIONS`).
2. Declare an Ax program (`question -> reply`) and set the seed as its instruction.
3. Run `AxGEPA` with a student model (drafts replies) and a teacher model (rewrites the
   prompt from the judge's natural-language critique).
4. The metric is the closeness-to-gold judge above. Feed its critique back as GEPA feedback
   so the rewrite knows _why_ a draft missed.
5. Bound the run with `maxMetricCalls` / `numTrials` so it stays inside Convex's 10-minute
   action limit, and always finalize a usable prompt (fall back to the seed, never abort
   empty).

Resolve the model lineup from env exactly like the reference's `resolveLineup`: a generator
model, one or more judge models, and a teacher model, each overridable by an env var with a
sane default (for example `SUPPORT_OPT_GENERATOR_MODEL`, `SUPPORT_OPT_JUDGE_MODELS`,
`SUPPORT_OPT_TEACHER_MODEL`). All of them run over OpenRouter with the existing
`OPENROUTER_API_KEY`. Reuse `orModel` / `captureDirect` from `src/lib/convex/aiUsage/` so the
optimizer's token spend is metered through the same cost-tracking pipeline as the rest of the
app.

## The override seam: where the optimized prompt lands

The support agent reads its instructions from a named export, `SUPPORT_AGENT_INSTRUCTIONS`,
instead of an inline literal. That export is the seam this recipe plugs into. Two ways to use
it:

- **Static**: have the optimizer print the winning prompt, then paste it in as the new value
  of `SUPPORT_AGENT_INSTRUCTIONS` and ship it. Simplest, fully reviewable in a diff, no schema
  change.
- **Dynamic**: store the optimized prompt in a small table (one active row, plus history),
  have the agent read the stored override and fall back to `SUPPORT_AGENT_INSTRUCTIONS` when
  none is set, and let the action write a new row at the end of a run. This lets you re-tune
  on a schedule as more tickets close, without a deploy.

Start static. Move to dynamic only once you are re-running the optimization regularly.

## Reference implementation

Copy the Ax wiring and the model-lineup env resolution from Cadenza's per-channel voice
optimizer:

- Repo: `stickerdaniel/cadenza-app`
- Path: `src/lib/convex/voice/`
  - `optimize.ts`: the `'use node'` GEPA action covering seed synthesis, the Ax program, the
    `AxGEPA` student/teacher setup, metric-call bounding, usage metering via a proxied
    `AxAIService`, and the seed fallback.
  - `optimize.eval.ts`: `resolveLineup` (env-driven generator / jury / teacher / quality
    models with defaults), the objective folding, and the floor/scalar scoring.

Take the structure and the env-resolution wholesale. Swap the spot-the-AI jury for the
closeness-to-gold judge described above, point the corpus at done `supportThreads` instead of
LinkedIn turns, and write the result through `SUPPORT_AGENT_INSTRUCTIONS`.
