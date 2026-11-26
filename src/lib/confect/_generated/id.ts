import { GenericId } from "@confect/core";
import type { SystemTableNames } from "convex/server";

export type TableNames = "adminAuditLogs" | "adminNotificationPreferences" | "adminProfiles" | "adminSettings" | "aiChatHistoryMigration" | "aiChatMessageReceipts" | "aiChatThreads" | "aiUsage" | "customerNotifications" | "dashboardCounters" | "emailEvents" | "fileMetadata" | "fileOwners" | "founderEmailSends" | "founderIncidentDrafts" | "founderIncidentEmails" | "founderWelcomeEmails" | "internalUserNotes" | "journeyCaptureStarts" | "messages" | "oauthGrantEpochs" | "passkeyNudgeDismissals" | "pendingAdminNotifications" | "personalEmailSuppressions" | "supportAgentPrompts" | "supportMessageContexts" | "supportNotificationReceipts" | "supportRateLimitAlerts" | "supportThreads";

export type Id<TableName extends TableNames | SystemTableNames> = GenericId.GenericId<TableName>;

export const Id = <const TableName extends TableNames | SystemTableNames>(
  tableName: TableName,
) => GenericId.GenericId(tableName);
