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
import support_files from "../support/files.spec";
import support_handoff from "../support/handoff.spec";
import support_messages from "../support/messages.spec";
import support_migration from "../support/migration.spec";
import support_promptStore from "../support/promptStore.spec";
import support_rateLimitAlerts from "../support/rateLimitAlerts.spec";
import support_readState from "../support/readState.spec";
import support_threads from "../support/threads.spec";

const spec: Spec.Spec<{
  readonly admin: GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "admin", never, GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "auditLog", never, GroupSpec.NamedAt<typeof admin_auditLog_queries, "queries">>, "auditLog"> | GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "customerNotifications", never, GroupSpec.NamedAt<typeof admin_customerNotifications_admission, "admission"> | GroupSpec.NamedAt<typeof admin_customerNotifications_cancel, "cancel"> | GroupSpec.NamedAt<typeof admin_customerNotifications_send, "send">>, "customerNotifications"> | GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "founderWelcome", never, GroupSpec.NamedAt<typeof admin_founderWelcome_mutations, "mutations"> | GroupSpec.NamedAt<typeof admin_founderWelcome_queries, "queries">>, "founderWelcome"> | GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "journey", never, GroupSpec.NamedAt<typeof admin_journey_erasure, "erasure"> | GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "sources", never, GroupSpec.NamedAt<typeof admin_journey_sources_aiChat, "aiChat"> | GroupSpec.NamedAt<typeof admin_journey_sources_community, "community"> | GroupSpec.NamedAt<typeof admin_journey_sources_support, "support">>, "sources">>, "journey"> | GroupSpec.NamedAt<typeof admin_mutations, "mutations"> | GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "notificationPreferences", never, GroupSpec.NamedAt<typeof admin_notificationPreferences_index, "index"> | GroupSpec.NamedAt<typeof admin_notificationPreferences_mutations, "mutations"> | GroupSpec.NamedAt<typeof admin_notificationPreferences_queries, "queries">>, "notificationPreferences"> | GroupSpec.NamedAt<typeof admin_queries, "queries"> | GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "support", never, GroupSpec.NamedAt<typeof admin_support_mutations, "mutations"> | GroupSpec.NamedAt<typeof admin_support_notificationDelivery, "notificationDelivery"> | GroupSpec.NamedAt<typeof admin_support_notifications, "notifications"> | GroupSpec.NamedAt<typeof admin_support_queries, "queries">>, "support">>, "admin">;
  readonly support: GroupSpec.NamedAt<GroupSpec.GroupSpec<"Convex", "support", never, GroupSpec.NamedAt<typeof support_files, "files"> | GroupSpec.NamedAt<typeof support_handoff, "handoff"> | GroupSpec.NamedAt<typeof support_messages, "messages"> | GroupSpec.NamedAt<typeof support_migration, "migration"> | GroupSpec.NamedAt<typeof support_promptStore, "promptStore"> | GroupSpec.NamedAt<typeof support_rateLimitAlerts, "rateLimitAlerts"> | GroupSpec.NamedAt<typeof support_readState, "readState"> | GroupSpec.NamedAt<typeof support_threads, "threads">>, "support">;
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
}) as typeof spec;

export default spec;
