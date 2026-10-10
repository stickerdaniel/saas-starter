# Admin customer emails

Admins can get an email when a customer pays for an eligible plan for the first time, with a timeline of what the customer did before paying. Autumn tells the app through its webhook that billing changed; the app then reads the customer from Autumn and decides for itself. The eligible plans, the delay after payment and the recipient limits live in [`policy.ts`](../../../src/lib/convex/admin/customerNotifications/policy.ts).

This guide covers what the code cannot: the Autumn dashboard, enabling and pausing, what is kept, and how to roll back.

## Setup

1. Configure billing first (`AUTUMN_SECRET_KEY`); the webhook reads each customer with it.
2. In the Autumn dashboard, add a webhook endpoint for `https://<your-deployment>.convex.site/autumn-webhook` and subscribe it to `billing.updated`. The handler also accepts the older `customer.products.updated`; every other event type is acknowledged and ignored.
3. Copy the endpoint's signing secret (it starts with `whsec_`) and set it on Convex: `bunx convex env set AUTUMN_WEBHOOK_SECRET <secret> --prod`. Until it is set, every delivery gets a 503 and nothing is admitted.
4. Optionally set `ADMIN_TIME_ZONE` to an IANA name such as `Europe/Berlin`. Times in the emails use UTC when it is unset or unknown.
5. Each admin chooses in `/admin/settings` whether they get the email. The setting is on by default.

**Existing customers.** There is no cut-off date. On a deployment that already has paying customers, each of them is emailed once, on their next billing event after you set the secret. Set it when that is acceptable, for example right after launch or after telling the admins.

**Testing a delivery.** Send a test event from the endpoint page in the Autumn sandbox and check its attempts there. A 2xx means the delivery was handled. A 503 means a retry may fix it: Svix redelivers on its own schedule, and the Convex logs name the cause with a fixed code such as `autumn_timeout` or `webhook_not_configured`. A 400 (`webhook_payload_malformed`) means the payload carried no usable customer id; redelivery will not change that. A 401 is a signature mismatch: compare the secret with the endpoint's.

## What is kept, and for how long

- The ledger keeps one row per customer's first payment, with the billing facts and the time window the email showed, until the customer's account is deleted.
- The email bodies stay in the Resend component until you clear them. The template schedules no cleanup; run `cleanupOldEmails` and `cleanupAbandonedEmails` from the Resend component in the Convex dashboard, or schedule them as the [component README](https://github.com/get-convex/resend#data-retention) shows.
- The existing `/resend-webhook` handler logs every delivery event of these emails and stores it in `emailEvents`, as for every other email. Nothing deletes those rows or logs automatically.
- Copies in the admins' inboxes cannot be recalled.

Deleting a customer's account deletes their ledger rows, cancels a send that has not started and any email the Resend component has not handed to Resend yet, and clears the journey facts recorded for them. It does not cover the three items above.

## Rollback

Work from consumers to producers. "No job" below means the Convex dashboard's scheduled functions show no pending or in-progress entry for that function.

1. **Pause.** Unset `AUTUMN_WEBHOOK_SECRET`. New deliveries get a 503 and Svix keeps retrying until it gives up, so they can be replayed from the Autumn dashboard later. Admission refuses from that moment, including deliveries that were verified before. Then cancel the pending `sendNewCustomer` jobs, or let them run; no new ones appear.
2. **Revert the emails.** Keep `sendNewCustomer` registered (a no-op is enough) until no job references it. Keep the erasure functions and the ledger table as long as a deleted user's ledger rows or journey facts can remain, so a blocked erasure stays recoverable. Never delete ledger rows to stop emails: each deleted row lets that customer be emailed again as new.
3. **Revert the journey capture** only after nothing reads it. Keep `markMessageSettled` registered (a no-op that still checks that the owner exists is enough) until no `enforceAndTrackMessageUsage` job from before the revert is in progress. Keep the stored fields and tables declared until a reviewed cleanup removes the data, and never delete `journeyCaptureStarts` rows. When you later enable a reverted capture again, set each affected row's `startedAt` to the time of that deploy in the same step, so emails say "recorded since" that time instead of claiming the gap was recorded.

An erasure that keeps failing logs `journey_erasure_blocked` with the user id and leaves its rows in place. After fixing the cause, rerun it with `bunx convex run admin/journey/erasure:continueErasure '{"userId":"<id>","step":"ledger","attempt":1}' --prod`.
