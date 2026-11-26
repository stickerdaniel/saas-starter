/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin_auditLog_queries from "../admin/auditLog/queries.js";
import type * as admin_customerNotifications_admission from "../admin/customerNotifications/admission.js";
import type * as admin_customerNotifications_cancel from "../admin/customerNotifications/cancel.js";
import type * as admin_customerNotifications_send from "../admin/customerNotifications/send.js";
import type * as admin_founderWelcome_mutations from "../admin/founderWelcome/mutations.js";
import type * as admin_founderWelcome_queries from "../admin/founderWelcome/queries.js";
import type * as admin_journey_erasure from "../admin/journey/erasure.js";
import type * as admin_journey_sources_aiChat from "../admin/journey/sources/aiChat.js";
import type * as admin_journey_sources_community from "../admin/journey/sources/community.js";
import type * as admin_journey_sources_support from "../admin/journey/sources/support.js";
import type * as admin_mutations from "../admin/mutations.js";
import type * as admin_notificationPreferences_index from "../admin/notificationPreferences/index.js";
import type * as admin_notificationPreferences_mutations from "../admin/notificationPreferences/mutations.js";
import type * as admin_notificationPreferences_queries from "../admin/notificationPreferences/queries.js";
import type * as admin_queries from "../admin/queries.js";
import type * as admin_support_mutations from "../admin/support/mutations.js";
import type * as admin_support_notificationDelivery from "../admin/support/notificationDelivery.js";
import type * as admin_support_notifications from "../admin/support/notifications.js";
import type * as admin_support_queries from "../admin/support/queries.js";
import type * as aiChat_activityMigration from "../aiChat/activityMigration.js";
import type * as aiChat_files from "../aiChat/files.js";
import type * as aiChat_messages from "../aiChat/messages.js";
import type * as aiChat_threads from "../aiChat/threads.js";
import type * as aiChat_titles from "../aiChat/titles.js";
import type * as aiUsage_record from "../aiUsage/record.js";
import type * as auth from "../auth.js";
import type * as autumn from "../autumn.js";
import type * as capabilities from "../capabilities.js";
import type * as crons from "../crons.js";
import type * as emails_events from "../emails/events.js";
import type * as emails_founderEmailBilling from "../emails/founderEmailBilling.js";
import type * as emails_founderEmailErasure from "../emails/founderEmailErasure.js";
import type * as emails_founderEmailLedger from "../emails/founderEmailLedger.js";
import type * as emails_founderEmails from "../emails/founderEmails.js";
import type * as emails_founderIncidentDelivery from "../emails/founderIncidentDelivery.js";
import type * as emails_founderIncidentDrafts from "../emails/founderIncidentDrafts.js";
import type * as emails_founderIncidentSend from "../emails/founderIncidentSend.js";
import type * as emails_send from "../emails/send.js";
import type * as files_cleanup from "../files/cleanup.js";
import type * as files_metadata from "../files/metadata.js";
import type * as files_owners from "../files/owners.js";
import type * as files_vacuum from "../files/vacuum.js";
import type * as http from "../http.js";
import type * as localDev from "../localDev.js";
import type * as messages from "../messages.js";
import type * as previewDev from "../previewDev.js";
import type * as storage from "../storage.js";
import type * as support_files from "../support/files.js";
import type * as support_handoff from "../support/handoff.js";
import type * as support_messages from "../support/messages.js";
import type * as support_migration from "../support/migration.js";
import type * as support_promptStore from "../support/promptStore.js";
import type * as support_rateLimitAlerts from "../support/rateLimitAlerts.js";
import type * as support_readState from "../support/readState.js";
import type * as support_threads from "../support/threads.js";
import type * as tests from "../tests.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "admin/auditLog/queries": typeof admin_auditLog_queries;
  "admin/customerNotifications/admission": typeof admin_customerNotifications_admission;
  "admin/customerNotifications/cancel": typeof admin_customerNotifications_cancel;
  "admin/customerNotifications/send": typeof admin_customerNotifications_send;
  "admin/founderWelcome/mutations": typeof admin_founderWelcome_mutations;
  "admin/founderWelcome/queries": typeof admin_founderWelcome_queries;
  "admin/journey/erasure": typeof admin_journey_erasure;
  "admin/journey/sources/aiChat": typeof admin_journey_sources_aiChat;
  "admin/journey/sources/community": typeof admin_journey_sources_community;
  "admin/journey/sources/support": typeof admin_journey_sources_support;
  "admin/mutations": typeof admin_mutations;
  "admin/notificationPreferences/index": typeof admin_notificationPreferences_index;
  "admin/notificationPreferences/mutations": typeof admin_notificationPreferences_mutations;
  "admin/notificationPreferences/queries": typeof admin_notificationPreferences_queries;
  "admin/queries": typeof admin_queries;
  "admin/support/mutations": typeof admin_support_mutations;
  "admin/support/notificationDelivery": typeof admin_support_notificationDelivery;
  "admin/support/notifications": typeof admin_support_notifications;
  "admin/support/queries": typeof admin_support_queries;
  "aiChat/activityMigration": typeof aiChat_activityMigration;
  "aiChat/files": typeof aiChat_files;
  "aiChat/messages": typeof aiChat_messages;
  "aiChat/threads": typeof aiChat_threads;
  "aiChat/titles": typeof aiChat_titles;
  "aiUsage/record": typeof aiUsage_record;
  auth: typeof auth;
  autumn: typeof autumn;
  capabilities: typeof capabilities;
  crons: typeof crons;
  "emails/events": typeof emails_events;
  "emails/founderEmailBilling": typeof emails_founderEmailBilling;
  "emails/founderEmailErasure": typeof emails_founderEmailErasure;
  "emails/founderEmailLedger": typeof emails_founderEmailLedger;
  "emails/founderEmails": typeof emails_founderEmails;
  "emails/founderIncidentDelivery": typeof emails_founderIncidentDelivery;
  "emails/founderIncidentDrafts": typeof emails_founderIncidentDrafts;
  "emails/founderIncidentSend": typeof emails_founderIncidentSend;
  "emails/send": typeof emails_send;
  "files/cleanup": typeof files_cleanup;
  "files/metadata": typeof files_metadata;
  "files/owners": typeof files_owners;
  "files/vacuum": typeof files_vacuum;
  http: typeof http;
  localDev: typeof localDev;
  messages: typeof messages;
  previewDev: typeof previewDev;
  storage: typeof storage;
  "support/files": typeof support_files;
  "support/handoff": typeof support_handoff;
  "support/messages": typeof support_messages;
  "support/migration": typeof support_migration;
  "support/promptStore": typeof support_promptStore;
  "support/rateLimitAlerts": typeof support_rateLimitAlerts;
  "support/readState": typeof support_readState;
  "support/threads": typeof support_threads;
  tests: typeof tests;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("../../convex-components/betterAuth/_generated/component.js").ComponentApi<"betterAuth">;
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
  autumn: import("@useautumn/convex/_generated/component.js").ComponentApi<"autumn">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  convexFilesControl: import("@gilhrpenner/convex-files-control/_generated/component.js").ComponentApi<"convexFilesControl">;
};
