---
name: incident-follow-up
description: Assess who a fixed production defect affected, draft a direct incident email, and send it after approval. Use when the user asks for an incident email, and to offer one after fixing a production bug.
metadata:
  harness: [claude, codex]
  platform: [darwin, linux, win32]
  scope: saas-starter
---

# Incident follow-up

Email only users whom durable production evidence proves hit the defect. When the user asked for an incident email, start the assessment. After fixing a production bug on your own, first ask the user whether they want one.

## Assess

Write an impact predicate for the UTC incident window: the action happened in the window, execution entered the broken path, the triggering state was present, and the outcome matches the defect. Prove each clause per user from a system-of-record source. Analytics only corroborates, and an attempt counts only when every matching attempt failed deterministically.

Recipients are users proven on every clause, minus test accounts (`isTestEmail`), deleted users, and unverified addresses. Keep admins in, since they use the product too.

Report the count, exclusions, and evidence gaps to the user. When asked who was affected, name each user with email, user ID, and evidence in private chat, and keep identities out of Git, PRs, issues, logs, and files.

## Draft

Write one plain-text draft per recipient account locale. Greet by first name, describe the affected action in general terms rather than as something you saw the recipient hit, own it in first person, say what works now, and apologize once. Leave out technical and provider details and promises beyond the fix.

## Send

Send once the fix is live in production and the user has approved the exact drafts, the count, and the criteria.

1. Add the incident key and templates to `src/lib/convex/emails/founderIncidentRegistry.ts`.
2. Rerun the audience query and abort if the count changed.
3. Call `emails/founderIncidentSend:queueFounderIncidentEmail` once per recipient.
4. Run `emails/founderIncidentDelivery:reconcileFounderIncidentEmailDelivery` per recipient until each reports a final delivery state, and before any retry.
