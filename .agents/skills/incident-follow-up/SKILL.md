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

Prepare new incidents as saved drafts. Queue only after the fix is live and the user has approved the exact messages, delivery envelopes, audience, and criteria.

1. Save localized templates with `emails/founderIncidentDrafts:saveDraft`. Use `expectedRevision: null` to create, or the saved revision to edit. Use `{{userFirstName}}` and `{{founderName}}` instead of storing personal names or addresses.
2. Call `emails/founderIncidentDrafts:previewDraft` per recipient. Show the rendered messages, recipient and sender addresses, reply-to, locale, and audience privately. Wait for approval.
3. Rerun the impact query. Abort if the eligible user-ID set differs from the approved audience, even when its count is unchanged.
4. Preview again and compare the complete approved snapshots. Any change requires renewed approval; a fresh `approvalDigest` does not grant it.
5. Call `emails/founderIncidentDrafts:queueDraft` once per recipient with the checked `approvalDigest`.
6. Run `emails/founderIncidentDelivery:reconcileFounderIncidentEmailDelivery` immediately, then at least 30 seconds apart for at most 15 minutes. Report terminal outcomes; otherwise report pending or uncertain. Never enqueue again, change the incident key, or delete the ledger to retry.
