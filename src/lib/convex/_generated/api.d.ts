/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin_adminHttpPaths from "../admin/adminHttpPaths.js";
import type * as admin_auditLog_queries from "../admin/auditLog/queries.js";
import type * as admin_auditLog_search from "../admin/auditLog/search.js";
import type * as admin_counters from "../admin/counters.js";
import type * as admin_founderWelcome_mutations from "../admin/founderWelcome/mutations.js";
import type * as admin_founderWelcome_queries from "../admin/founderWelcome/queries.js";
import type * as admin_mutations from "../admin/mutations.js";
import type * as admin_notificationPreferences_helpers from "../admin/notificationPreferences/helpers.js";
import type * as admin_notificationPreferences_index from "../admin/notificationPreferences/index.js";
import type * as admin_notificationPreferences_mutations from "../admin/notificationPreferences/mutations.js";
import type * as admin_notificationPreferences_queries from "../admin/notificationPreferences/queries.js";
import type * as admin_queries from "../admin/queries.js";
import type * as admin_support_constants from "../admin/support/constants.js";
import type * as admin_support_mutations from "../admin/support/mutations.js";
import type * as admin_support_notifications from "../admin/support/notifications.js";
import type * as admin_support_queries from "../admin/support/queries.js";
import type * as admin_types from "../admin/types.js";
import type * as admin_userSearch from "../admin/userSearch.js";
import type * as aiChat_agent from "../aiChat/agent.js";
import type * as aiChat_files from "../aiChat/files.js";
import type * as aiChat_messages from "../aiChat/messages.js";
import type * as aiChat_ownership from "../aiChat/ownership.js";
import type * as aiChat_rateLimit from "../aiChat/rateLimit.js";
import type * as aiChat_threads from "../aiChat/threads.js";
import type * as aiChat_titles from "../aiChat/titles.js";
import type * as aiChat_tools_weather from "../aiChat/tools/weather.js";
import type * as aiChat_visibility from "../aiChat/visibility.js";
import type * as aiUsage_agentUsage from "../aiUsage/agentUsage.js";
import type * as aiUsage_capture from "../aiUsage/capture.js";
import type * as aiUsage_record from "../aiUsage/record.js";
import type * as auth from "../auth.js";
import type * as autumn from "../autumn.js";
import type * as constants from "../constants.js";
import type * as crons from "../crons.js";
import type * as emails__generated_adminReplyNotification from "../emails/_generated/adminReplyNotification.js";
import type * as emails__generated_index from "../emails/_generated/index.js";
import type * as emails__generated_newTicketAdminNotification from "../emails/_generated/newTicketAdminNotification.js";
import type * as emails__generated_newUserSignupNotification from "../emails/_generated/newUserSignupNotification.js";
import type * as emails__generated_passwordReset from "../emails/_generated/passwordReset.js";
import type * as emails__generated_verification from "../emails/_generated/verification.js";
import type * as emails__generated_verificationCode from "../emails/_generated/verificationCode.js";
import type * as emails_events from "../emails/events.js";
import type * as emails_helpers from "../emails/helpers.js";
import type * as emails_resend from "../emails/resend.js";
import type * as emails_send from "../emails/send.js";
import type * as emails_templates from "../emails/templates.js";
import type * as env from "../env.js";
import type * as files_attachmentText from "../files/attachmentText.js";
import type * as files_cleanup from "../files/cleanup.js";
import type * as files_metadata from "../files/metadata.js";
import type * as files_upload from "../files/upload.js";
import type * as files_vacuum from "../files/vacuum.js";
import type * as files_validators from "../files/validators.js";
import type * as functions from "../functions.js";
import type * as http from "../http.js";
import type * as i18n_translations from "../i18n/translations.js";
import type * as localDev from "../localDev.js";
import type * as messages from "../messages.js";
import type * as previewDev from "../previewDev.js";
import type * as pricing_prices from "../pricing/prices.js";
import type * as rateLimit from "../rateLimit.js";
import type * as storage from "../storage.js";
import type * as support_agent from "../support/agent.js";
import type * as support_denormalization from "../support/denormalization.js";
import type * as support_files from "../support/files.js";
import type * as support_handoff from "../support/handoff.js";
import type * as support_messageListing from "../support/messageListing.js";
import type * as support_messages from "../support/messages.js";
import type * as support_migration from "../support/migration.js";
import type * as support_ownership from "../support/ownership.js";
import type * as support_promptStore from "../support/promptStore.js";
import type * as support_rateLimit from "../support/rateLimit.js";
import type * as support_supportThreadFields from "../support/supportThreadFields.js";
import type * as support_threads from "../support/threads.js";
import type * as support_tools_handoff from "../support/tools/handoff.js";
import type * as support_types from "../support/types.js";
import type * as tests from "../tests.js";
import type * as users from "../users.js";
import type * as utils_anonymousUser from "../utils/anonymousUser.js";
import type * as utils_chatModel from "../utils/chatModel.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "admin/adminHttpPaths": typeof admin_adminHttpPaths;
  "admin/auditLog/queries": typeof admin_auditLog_queries;
  "admin/auditLog/search": typeof admin_auditLog_search;
  "admin/counters": typeof admin_counters;
  "admin/founderWelcome/mutations": typeof admin_founderWelcome_mutations;
  "admin/founderWelcome/queries": typeof admin_founderWelcome_queries;
  "admin/mutations": typeof admin_mutations;
  "admin/notificationPreferences/helpers": typeof admin_notificationPreferences_helpers;
  "admin/notificationPreferences/index": typeof admin_notificationPreferences_index;
  "admin/notificationPreferences/mutations": typeof admin_notificationPreferences_mutations;
  "admin/notificationPreferences/queries": typeof admin_notificationPreferences_queries;
  "admin/queries": typeof admin_queries;
  "admin/support/constants": typeof admin_support_constants;
  "admin/support/mutations": typeof admin_support_mutations;
  "admin/support/notifications": typeof admin_support_notifications;
  "admin/support/queries": typeof admin_support_queries;
  "admin/types": typeof admin_types;
  "admin/userSearch": typeof admin_userSearch;
  "aiChat/agent": typeof aiChat_agent;
  "aiChat/files": typeof aiChat_files;
  "aiChat/messages": typeof aiChat_messages;
  "aiChat/ownership": typeof aiChat_ownership;
  "aiChat/rateLimit": typeof aiChat_rateLimit;
  "aiChat/threads": typeof aiChat_threads;
  "aiChat/titles": typeof aiChat_titles;
  "aiChat/tools/weather": typeof aiChat_tools_weather;
  "aiChat/visibility": typeof aiChat_visibility;
  "aiUsage/agentUsage": typeof aiUsage_agentUsage;
  "aiUsage/capture": typeof aiUsage_capture;
  "aiUsage/record": typeof aiUsage_record;
  auth: typeof auth;
  autumn: typeof autumn;
  constants: typeof constants;
  crons: typeof crons;
  "emails/_generated/adminReplyNotification": typeof emails__generated_adminReplyNotification;
  "emails/_generated/index": typeof emails__generated_index;
  "emails/_generated/newTicketAdminNotification": typeof emails__generated_newTicketAdminNotification;
  "emails/_generated/newUserSignupNotification": typeof emails__generated_newUserSignupNotification;
  "emails/_generated/passwordReset": typeof emails__generated_passwordReset;
  "emails/_generated/verification": typeof emails__generated_verification;
  "emails/_generated/verificationCode": typeof emails__generated_verificationCode;
  "emails/events": typeof emails_events;
  "emails/helpers": typeof emails_helpers;
  "emails/resend": typeof emails_resend;
  "emails/send": typeof emails_send;
  "emails/templates": typeof emails_templates;
  env: typeof env;
  "files/attachmentText": typeof files_attachmentText;
  "files/cleanup": typeof files_cleanup;
  "files/metadata": typeof files_metadata;
  "files/upload": typeof files_upload;
  "files/vacuum": typeof files_vacuum;
  "files/validators": typeof files_validators;
  functions: typeof functions;
  http: typeof http;
  "i18n/translations": typeof i18n_translations;
  localDev: typeof localDev;
  messages: typeof messages;
  previewDev: typeof previewDev;
  "pricing/prices": typeof pricing_prices;
  rateLimit: typeof rateLimit;
  storage: typeof storage;
  "support/agent": typeof support_agent;
  "support/denormalization": typeof support_denormalization;
  "support/files": typeof support_files;
  "support/handoff": typeof support_handoff;
  "support/messageListing": typeof support_messageListing;
  "support/messages": typeof support_messages;
  "support/migration": typeof support_migration;
  "support/ownership": typeof support_ownership;
  "support/promptStore": typeof support_promptStore;
  "support/rateLimit": typeof support_rateLimit;
  "support/supportThreadFields": typeof support_supportThreadFields;
  "support/threads": typeof support_threads;
  "support/tools/handoff": typeof support_tools_handoff;
  "support/types": typeof support_types;
  tests: typeof tests;
  users: typeof users;
  "utils/anonymousUser": typeof utils_anonymousUser;
  "utils/chatModel": typeof utils_chatModel;
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
  betterAuth: import("../betterAuth/_generated/component.js").ComponentApi<"betterAuth">;
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
  autumn: import("@useautumn/convex/_generated/component.js").ComponentApi<"autumn">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  convexFilesControl: import("@gilhrpenner/convex-files-control/_generated/component.js").ComponentApi<"convexFilesControl">;
};
