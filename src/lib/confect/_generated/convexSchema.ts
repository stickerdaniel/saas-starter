import { defineSchema as $defineSchema } from "convex/server";
import { Table as $Table } from "@confect/server";

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
import oauthGrantEpochs from "./tables/oauthGrantEpochs";
import passkeyNudgeDismissals from "./tables/passkeyNudgeDismissals";
import pendingAdminNotifications from "./tables/pendingAdminNotifications";
import personalEmailSuppressions from "./tables/personalEmailSuppressions";
import supportAgentPrompts from "./tables/supportAgentPrompts";
import supportMessageContexts from "./tables/supportMessageContexts";
import supportNotificationReceipts from "./tables/supportNotificationReceipts";
import supportRateLimitAlerts from "./tables/supportRateLimitAlerts";
import supportThreads from "./tables/supportThreads";

export default $defineSchema({
  adminAuditLogs: $Table.tableDefinition(adminAuditLogs),
  adminNotificationPreferences: $Table.tableDefinition(adminNotificationPreferences),
  adminProfiles: $Table.tableDefinition(adminProfiles),
  adminSettings: $Table.tableDefinition(adminSettings),
  aiChatHistoryMigration: $Table.tableDefinition(aiChatHistoryMigration),
  aiChatMessageReceipts: $Table.tableDefinition(aiChatMessageReceipts),
  aiChatThreads: $Table.tableDefinition(aiChatThreads),
  aiUsage: $Table.tableDefinition(aiUsage),
  customerNotifications: $Table.tableDefinition(customerNotifications),
  dashboardCounters: $Table.tableDefinition(dashboardCounters),
  emailEvents: $Table.tableDefinition(emailEvents),
  fileMetadata: $Table.tableDefinition(fileMetadata),
  fileOwners: $Table.tableDefinition(fileOwners),
  founderEmailSends: $Table.tableDefinition(founderEmailSends),
  founderIncidentDrafts: $Table.tableDefinition(founderIncidentDrafts),
  founderIncidentEmails: $Table.tableDefinition(founderIncidentEmails),
  founderWelcomeEmails: $Table.tableDefinition(founderWelcomeEmails),
  internalUserNotes: $Table.tableDefinition(internalUserNotes),
  journeyCaptureStarts: $Table.tableDefinition(journeyCaptureStarts),
  messages: $Table.tableDefinition(messages),
  oauthGrantEpochs: $Table.tableDefinition(oauthGrantEpochs),
  passkeyNudgeDismissals: $Table.tableDefinition(passkeyNudgeDismissals),
  pendingAdminNotifications: $Table.tableDefinition(pendingAdminNotifications),
  personalEmailSuppressions: $Table.tableDefinition(personalEmailSuppressions),
  supportAgentPrompts: $Table.tableDefinition(supportAgentPrompts),
  supportMessageContexts: $Table.tableDefinition(supportMessageContexts),
  supportNotificationReceipts: $Table.tableDefinition(supportNotificationReceipts),
  supportRateLimitAlerts: $Table.tableDefinition(supportRateLimitAlerts),
  supportThreads: $Table.tableDefinition(supportThreads),
});
