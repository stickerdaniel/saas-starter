import { GroupSpec, Spec } from "@confect/core";
import admin_auditLog_queries from "../admin/auditLog/queries.spec";
import admin_customerNotifications_admission from "../admin/customerNotifications/admission.spec";
import admin_customerNotifications_cancel from "../admin/customerNotifications/cancel.spec";
import admin_customerNotifications_send from "../admin/customerNotifications/send.spec";
import admin_founderWelcome_mutations from "../admin/founderWelcome/mutations.spec";
import admin_founderWelcome_queries from "../admin/founderWelcome/queries.spec";
import admin_journey_erasure from "../admin/journey/erasure.spec";
import admin_journey_sources_aiChat from "../admin/journey/sources/aiChat.spec";
import admin_journey_sources_community from "../admin/journey/sources/community.spec";
import admin_journey_sources_support from "../admin/journey/sources/support.spec";
import admin_mutations from "../admin/mutations.spec";
import admin_notificationPreferences_index from "../admin/notificationPreferences/index.spec";
import admin_notificationPreferences_mutations from "../admin/notificationPreferences/mutations.spec";
import admin_notificationPreferences_queries from "../admin/notificationPreferences/queries.spec";
import admin_queries from "../admin/queries.spec";
import admin_support_mutations from "../admin/support/mutations.spec";
import admin_support_notificationDelivery from "../admin/support/notificationDelivery.spec";
import admin_support_notifications from "../admin/support/notifications.spec";
import admin_support_queries from "../admin/support/queries.spec";
import aiChat_activityMigration from "../aiChat/activityMigration.spec";
import aiChat_files from "../aiChat/files.spec";
import aiChat_messages from "../aiChat/messages.spec";
import aiChat_threads from "../aiChat/threads.spec";
import aiChat_titles from "../aiChat/titles.spec";
import aiUsage_record from "../aiUsage/record.spec";
import auth from "../auth.spec";
import autumn from "../autumn.spec";
import capabilities from "../capabilities.spec";
import emails_events from "../emails/events.spec";
import emails_founderEmailBilling from "../emails/founderEmailBilling.spec";
import emails_founderEmailErasure from "../emails/founderEmailErasure.spec";
import emails_founderEmailLedger from "../emails/founderEmailLedger.spec";
import emails_founderEmails from "../emails/founderEmails.spec";
import emails_founderIncidentDelivery from "../emails/founderIncidentDelivery.spec";
import emails_founderIncidentDrafts from "../emails/founderIncidentDrafts.spec";
import emails_founderIncidentSend from "../emails/founderIncidentSend.spec";
import emails_send from "../emails/send.spec";
import files_cleanup from "../files/cleanup.spec";
import files_metadata from "../files/metadata.spec";
import files_vacuum from "../files/vacuum.spec";
import localDev from "../localDev.spec";
import messages from "../messages.spec";
import previewDev from "../previewDev.spec";
import storage from "../storage.spec";
import support_files from "../support/files.spec";
import support_handoff from "../support/handoff.spec";
import support_messages from "../support/messages.spec";
import support_migration from "../support/migration.spec";
import support_promptStore from "../support/promptStore.spec";
import support_rateLimitAlerts from "../support/rateLimitAlerts.spec";
import support_readState from "../support/readState.spec";
import support_threads from "../support/threads.spec";
import tests from "../tests.spec";
import users from "../users.spec";

const spec: Spec.Spec<{
  readonly admin: GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "admin", never, GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "auditLog", never, GroupSpec.NamedAt<typeof admin_auditLog_queries, "queries">>, "auditLog"> | GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "customerNotifications", never, GroupSpec.NamedAt<typeof admin_customerNotifications_admission, "admission"> | GroupSpec.NamedAt<typeof admin_customerNotifications_cancel, "cancel"> | GroupSpec.NamedAt<typeof admin_customerNotifications_send, "send">>, "customerNotifications"> | GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "founderWelcome", never, GroupSpec.NamedAt<typeof admin_founderWelcome_mutations, "mutations"> | GroupSpec.NamedAt<typeof admin_founderWelcome_queries, "queries">>, "founderWelcome"> | GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "journey", never, GroupSpec.NamedAt<typeof admin_journey_erasure, "erasure"> | GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "sources", never, GroupSpec.NamedAt<typeof admin_journey_sources_aiChat, "aiChat"> | GroupSpec.NamedAt<typeof admin_journey_sources_community, "community"> | GroupSpec.NamedAt<typeof admin_journey_sources_support, "support">>, "sources">>, "journey"> | GroupSpec.NamedAt<typeof admin_mutations, "mutations"> | GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "notificationPreferences", never, GroupSpec.NamedAt<typeof admin_notificationPreferences_index, "index"> | GroupSpec.NamedAt<typeof admin_notificationPreferences_mutations, "mutations"> | GroupSpec.NamedAt<typeof admin_notificationPreferences_queries, "queries">>, "notificationPreferences"> | GroupSpec.NamedAt<typeof admin_queries, "queries"> | GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "support", never, GroupSpec.NamedAt<typeof admin_support_mutations, "mutations"> | GroupSpec.NamedAt<typeof admin_support_notificationDelivery, "notificationDelivery"> | GroupSpec.NamedAt<typeof admin_support_notifications, "notifications"> | GroupSpec.NamedAt<typeof admin_support_queries, "queries">>, "support">>, "admin">;
  readonly aiChat: GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "aiChat", never, GroupSpec.NamedAt<typeof aiChat_activityMigration, "activityMigration"> | GroupSpec.NamedAt<typeof aiChat_files, "files"> | GroupSpec.NamedAt<typeof aiChat_messages, "messages"> | GroupSpec.NamedAt<typeof aiChat_threads, "threads"> | GroupSpec.NamedAt<typeof aiChat_titles, "titles">>, "aiChat">;
  readonly aiUsage: GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "aiUsage", never, GroupSpec.NamedAt<typeof aiUsage_record, "record">>, "aiUsage">;
  readonly auth: GroupSpec.NamedAt<typeof auth, "auth">;
  readonly autumn: GroupSpec.NamedAt<typeof autumn, "autumn">;
  readonly capabilities: GroupSpec.NamedAt<typeof capabilities, "capabilities">;
  readonly emails: GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "emails", never, GroupSpec.NamedAt<typeof emails_events, "events"> | GroupSpec.NamedAt<typeof emails_founderEmailBilling, "founderEmailBilling"> | GroupSpec.NamedAt<typeof emails_founderEmailErasure, "founderEmailErasure"> | GroupSpec.NamedAt<typeof emails_founderEmailLedger, "founderEmailLedger"> | GroupSpec.NamedAt<typeof emails_founderEmails, "founderEmails"> | GroupSpec.NamedAt<typeof emails_founderIncidentDelivery, "founderIncidentDelivery"> | GroupSpec.NamedAt<typeof emails_founderIncidentDrafts, "founderIncidentDrafts"> | GroupSpec.NamedAt<typeof emails_founderIncidentSend, "founderIncidentSend"> | GroupSpec.NamedAt<typeof emails_send, "send">>, "emails">;
  readonly files: GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "files", never, GroupSpec.NamedAt<typeof files_cleanup, "cleanup"> | GroupSpec.NamedAt<typeof files_metadata, "metadata"> | GroupSpec.NamedAt<typeof files_vacuum, "vacuum">>, "files">;
  readonly localDev: GroupSpec.NamedAt<typeof localDev, "localDev">;
  readonly messages: GroupSpec.NamedAt<typeof messages, "messages">;
  readonly previewDev: GroupSpec.NamedAt<typeof previewDev, "previewDev">;
  readonly storage: GroupSpec.NamedAt<typeof storage, "storage">;
  readonly support: GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "support", never, GroupSpec.NamedAt<typeof support_files, "files"> | GroupSpec.NamedAt<typeof support_handoff, "handoff"> | GroupSpec.NamedAt<typeof support_messages, "messages"> | GroupSpec.NamedAt<typeof support_migration, "migration"> | GroupSpec.NamedAt<typeof support_promptStore, "promptStore"> | GroupSpec.NamedAt<typeof support_rateLimitAlerts, "rateLimitAlerts"> | GroupSpec.NamedAt<typeof support_readState, "readState"> | GroupSpec.NamedAt<typeof support_threads, "threads">>, "support">;
  readonly tests: GroupSpec.NamedAt<typeof tests, "tests">;
  readonly users: GroupSpec.NamedAt<typeof users, "users">;
}> = Spec.fromGroups({
  ["admin"]: GroupSpec.addGroupsAt(GroupSpec.make(), {
    ["auditLog"]: GroupSpec.addGroupsAt(GroupSpec.make(), {
      ["queries"]: admin_auditLog_queries,
    }),
    ["customerNotifications"]: GroupSpec.addGroupsAt(GroupSpec.make(), {
      ["admission"]: admin_customerNotifications_admission,
      ["cancel"]: admin_customerNotifications_cancel,
      ["send"]: admin_customerNotifications_send,
    }),
    ["founderWelcome"]: GroupSpec.addGroupsAt(GroupSpec.make(), {
      ["mutations"]: admin_founderWelcome_mutations,
      ["queries"]: admin_founderWelcome_queries,
    }),
    ["journey"]: GroupSpec.addGroupsAt(GroupSpec.make(), {
      ["erasure"]: admin_journey_erasure,
      ["sources"]: GroupSpec.addGroupsAt(GroupSpec.make(), {
        ["aiChat"]: admin_journey_sources_aiChat,
        ["community"]: admin_journey_sources_community,
        ["support"]: admin_journey_sources_support,
      }),
    }),
    ["mutations"]: admin_mutations,
    ["notificationPreferences"]: GroupSpec.addGroupsAt(GroupSpec.make(), {
      ["index"]: admin_notificationPreferences_index,
      ["mutations"]: admin_notificationPreferences_mutations,
      ["queries"]: admin_notificationPreferences_queries,
    }),
    ["queries"]: admin_queries,
    ["support"]: GroupSpec.addGroupsAt(GroupSpec.make(), {
      ["mutations"]: admin_support_mutations,
      ["notificationDelivery"]: admin_support_notificationDelivery,
      ["notifications"]: admin_support_notifications,
      ["queries"]: admin_support_queries,
    }),
  }),
  ["aiChat"]: GroupSpec.addGroupsAt(GroupSpec.make(), {
    ["activityMigration"]: aiChat_activityMigration,
    ["files"]: aiChat_files,
    ["messages"]: aiChat_messages,
    ["threads"]: aiChat_threads,
    ["titles"]: aiChat_titles,
  }),
  ["aiUsage"]: GroupSpec.addGroupsAt(GroupSpec.make(), {
    ["record"]: aiUsage_record,
  }),
  ["auth"]: auth,
  ["autumn"]: autumn,
  ["capabilities"]: capabilities,
  ["emails"]: GroupSpec.addGroupsAt(GroupSpec.make(), {
    ["events"]: emails_events,
    ["founderEmailBilling"]: emails_founderEmailBilling,
    ["founderEmailErasure"]: emails_founderEmailErasure,
    ["founderEmailLedger"]: emails_founderEmailLedger,
    ["founderEmails"]: emails_founderEmails,
    ["founderIncidentDelivery"]: emails_founderIncidentDelivery,
    ["founderIncidentDrafts"]: emails_founderIncidentDrafts,
    ["founderIncidentSend"]: emails_founderIncidentSend,
    ["send"]: emails_send,
  }),
  ["files"]: GroupSpec.addGroupsAt(GroupSpec.make(), {
    ["cleanup"]: files_cleanup,
    ["metadata"]: files_metadata,
    ["vacuum"]: files_vacuum,
  }),
  ["localDev"]: localDev,
  ["messages"]: messages,
  ["previewDev"]: previewDev,
  ["storage"]: storage,
  ["support"]: GroupSpec.addGroupsAt(GroupSpec.make(), {
    ["files"]: support_files,
    ["handoff"]: support_handoff,
    ["messages"]: support_messages,
    ["migration"]: support_migration,
    ["promptStore"]: support_promptStore,
    ["rateLimitAlerts"]: support_rateLimitAlerts,
    ["readState"]: support_readState,
    ["threads"]: support_threads,
  }),
  ["tests"]: tests,
  ["users"]: users,
}) as typeof spec;

export default spec;
