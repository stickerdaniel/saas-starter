import { DatabaseSchema as $DatabaseSchema } from "@confect/server";

import adminAuditLogs from "./tables/adminAuditLogs";
import adminNotificationPreferences from "./tables/adminNotificationPreferences";
import adminProfiles from "./tables/adminProfiles";
import adminSettings from "./tables/adminSettings";
import aiChatHistoryMigration from "./tables/aiChatHistoryMigration";
import aiChatMessageReceipts from "./tables/aiChatMessageReceipts";
import aiChatThreads from "./tables/aiChatThreads";
import aiUsage from "./tables/aiUsage";
import customerNotifications from "./tables/customerNotifications";
import dashboardCounters from "./tables/dashboardCounters";
import emailEvents from "./tables/emailEvents";
import fileMetadata from "./tables/fileMetadata";
import fileOwners from "./tables/fileOwners";
import founderEmailSends from "./tables/founderEmailSends";
import founderIncidentDrafts from "./tables/founderIncidentDrafts";
import founderIncidentEmails from "./tables/founderIncidentEmails";
import founderWelcomeEmails from "./tables/founderWelcomeEmails";
import internalUserNotes from "./tables/internalUserNotes";
import journeyCaptureStarts from "./tables/journeyCaptureStarts";
import messages from "./tables/messages";
import oauthConnectionUses from "./tables/oauthConnectionUses";
import oauthGrantEpochs from "./tables/oauthGrantEpochs";
import passkeyNudgeDismissals from "./tables/passkeyNudgeDismissals";
import pendingAdminNotifications from "./tables/pendingAdminNotifications";
import personalEmailSuppressions from "./tables/personalEmailSuppressions";
import supportAgentPrompts from "./tables/supportAgentPrompts";
import supportMessageContexts from "./tables/supportMessageContexts";
import supportNotificationReceipts from "./tables/supportNotificationReceipts";
import supportRateLimitAlerts from "./tables/supportRateLimitAlerts";
import supportThreads from "./tables/supportThreads";

const databaseSchema: $DatabaseSchema.DatabaseSchema<{
  readonly adminAuditLogs: typeof adminAuditLogs;
  readonly adminNotificationPreferences: typeof adminNotificationPreferences;
  readonly adminProfiles: typeof adminProfiles;
  readonly adminSettings: typeof adminSettings;
  readonly aiChatHistoryMigration: typeof aiChatHistoryMigration;
  readonly aiChatMessageReceipts: typeof aiChatMessageReceipts;
  readonly aiChatThreads: typeof aiChatThreads;
  readonly aiUsage: typeof aiUsage;
  readonly customerNotifications: typeof customerNotifications;
  readonly dashboardCounters: typeof dashboardCounters;
  readonly emailEvents: typeof emailEvents;
  readonly fileMetadata: typeof fileMetadata;
  readonly fileOwners: typeof fileOwners;
  readonly founderEmailSends: typeof founderEmailSends;
  readonly founderIncidentDrafts: typeof founderIncidentDrafts;
  readonly founderIncidentEmails: typeof founderIncidentEmails;
  readonly founderWelcomeEmails: typeof founderWelcomeEmails;
  readonly internalUserNotes: typeof internalUserNotes;
  readonly journeyCaptureStarts: typeof journeyCaptureStarts;
  readonly messages: typeof messages;
  readonly oauthConnectionUses: typeof oauthConnectionUses;
  readonly oauthGrantEpochs: typeof oauthGrantEpochs;
  readonly passkeyNudgeDismissals: typeof passkeyNudgeDismissals;
  readonly pendingAdminNotifications: typeof pendingAdminNotifications;
  readonly personalEmailSuppressions: typeof personalEmailSuppressions;
  readonly supportAgentPrompts: typeof supportAgentPrompts;
  readonly supportMessageContexts: typeof supportMessageContexts;
  readonly supportNotificationReceipts: typeof supportNotificationReceipts;
  readonly supportRateLimitAlerts: typeof supportRateLimitAlerts;
  readonly supportThreads: typeof supportThreads;
}> = $DatabaseSchema.make({
  adminAuditLogs,
  adminNotificationPreferences,
  adminProfiles,
  adminSettings,
  aiChatHistoryMigration,
  aiChatMessageReceipts,
  aiChatThreads,
  aiUsage,
  customerNotifications,
  dashboardCounters,
  emailEvents,
  fileMetadata,
  fileOwners,
  founderEmailSends,
  founderIncidentDrafts,
  founderIncidentEmails,
  founderWelcomeEmails,
  internalUserNotes,
  journeyCaptureStarts,
  messages,
  oauthConnectionUses,
  oauthGrantEpochs,
  passkeyNudgeDismissals,
  pendingAdminNotifications,
  personalEmailSuppressions,
  supportAgentPrompts,
  supportMessageContexts,
  supportNotificationReceipts,
  supportRateLimitAlerts,
  supportThreads,
});

export default databaseSchema;
