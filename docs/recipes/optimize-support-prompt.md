# Recipe: optimize the support prompt from resolved tickets

This is an optional extension for mature forks, not a built-in feature. Wait until the product has dozens of genuinely resolved support conversations; a tiny or noisy corpus teaches an optimizer little beyond the seed prompt.

## Training corpus

Build one example per resolved thread:

- **Input:** the opening user question plus the minimum context needed to make it unambiguous.
- **Gold answer:** the real response that resolved the thread.

Exclude spam, duplicates, abandoned conversations, and threads closed without a useful answer. The current support storage and prompt-override seam live under [`src/lib/convex/support/`](../../src/lib/convex/support/); inspect those modules rather than copying symbol names from this recipe.

## Objective

Optimize for closeness to the successful resolution, not human imitation. A useful judge scores:

- correctness — it reaches the same resolution without contradiction;
- helpfulness — it answers the actual request and gives the right next step;
- brand fit — it follows the fork's support tone.

Fold the scores into one scalar and apply a floor: an incorrect or unhelpful answer must score near zero even when its wording overlaps the gold response. Lexical overlap can be a small independent signal, but an outcome-aware judge should carry most of the weight.

## Execution shape

Run optimization in a bounded Node action or an offline job:

1. Start from the current reviewed support instruction.
2. Split resolved examples into train and validation sets.
3. Generate candidate replies and score them against the gold answers.
4. Let the optimizer revise the instruction from the judge's structured critique.
5. Cap trials, model calls, concurrency, and wall-clock time.
6. Compare the winner with the current instruction on the held-out set.
7. Persist or print a candidate only when it clears the existing score.

Use the application's existing model provider and usage-metering boundary. Never write ticket bodies, user identities, or model critiques into analytics. Treat the winning prompt as reviewed application behavior: retain an immediate rollback to the previous prompt or checked-in seed.

## Static versus dynamic rollout

- **Static:** print the winning instruction, review it, and ship it as code. This is the simplest starting point and gives a normal diff and rollback.
- **Dynamic:** save versioned prompts through the existing support prompt store when repeated optimization justifies runtime switching. Keep the checked-in seed as the fallback.

Start static. Move to dynamic only after optimization is repeatable, evaluated, and operationally owned.

## Reference implementation

Cadenza's per-channel writing optimizer is a worked example of the execution structure, not a live dependency. The links are pinned so this recipe cannot silently change underneath a fork:

- [`voice/optimize.ts`](https://github.com/stickerdaniel/cadenza-app/blob/b83533e38706255fd5814cae8fc2694000cf0279/src/lib/convex/voice/optimize.ts) — bounded optimization, model usage capture, and fallback behavior.
- [`voice/optimize.eval.ts`](https://github.com/stickerdaniel/cadenza-app/blob/b83533e38706255fd5814cae8fc2694000cf0279/src/lib/convex/voice/optimize.eval.ts) — lineup resolution and objective folding.

Copy the architecture only after inspecting the current fork. Replace Cadenza's imitation-specific judge with the resolution objective above.
