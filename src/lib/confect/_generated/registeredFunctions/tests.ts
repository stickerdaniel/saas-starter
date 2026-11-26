import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../schema";
import groupLayer from "../../tests.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../tests.spec")["default"]>(databaseSchema, groupLayer);

export default {
["cleanupAnonymousSupportThreads"]: RegisteredConvexFunction.register({ ...definitions["cleanupAnonymousSupportThreads"], handler: forward(definitions["cleanupAnonymousSupportThreads"].handler) }),
["cleanupTestData"]: RegisteredConvexFunction.register({ ...definitions["cleanupTestData"], handler: forward(definitions["cleanupTestData"].handler) }),
["createAnonymousSupportThread"]: RegisteredConvexFunction.register({ ...definitions["createAnonymousSupportThread"], handler: forward(definitions["createAnonymousSupportThread"].handler) }),
["createTestAdminUser"]: RegisteredConvexFunction.register({ ...definitions["createTestAdminUser"], handler: forward(definitions["createTestAdminUser"].handler) }),
["createUnreadAnonymousSupportReply"]: RegisteredConvexFunction.register({ ...definitions["createUnreadAnonymousSupportReply"], handler: forward(definitions["createUnreadAnonymousSupportReply"].handler) }),
["deleteAiChatHistoryRows"]: RegisteredConvexFunction.register({ ...definitions["deleteAiChatHistoryRows"], handler: forward(definitions["deleteAiChatHistoryRows"].handler) }),
["deleteAuditLogRows"]: RegisteredConvexFunction.register({ ...definitions["deleteAuditLogRows"], handler: forward(definitions["deleteAuditLogRows"].handler) }),
["deleteOwnedFixture"]: RegisteredConvexFunction.register({ ...definitions["deleteOwnedFixture"], handler: forward(definitions["deleteOwnedFixture"].handler) }),
["deleteSupportNotificationFixture"]: RegisteredConvexFunction.register({ ...definitions["deleteSupportNotificationFixture"], handler: forward(definitions["deleteSupportNotificationFixture"].handler) }),
["deleteTestUser"]: RegisteredConvexFunction.register({ ...definitions["deleteTestUser"], handler: forward(definitions["deleteTestUser"].handler) }),
["findOwnedTestData"]: RegisteredConvexFunction.register({ ...definitions["findOwnedTestData"], handler: forward(definitions["findOwnedTestData"].handler) }),
["getAuthUserIdByEmail"]: RegisteredConvexFunction.register({ ...definitions["getAuthUserIdByEmail"], handler: forward(definitions["getAuthUserIdByEmail"].handler) }),
["getLegacyAuditLogCursor"]: RegisteredConvexFunction.register({ ...definitions["getLegacyAuditLogCursor"], handler: forward(definitions["getLegacyAuditLogCursor"].handler) }),
["getPasswordResetToken"]: RegisteredConvexFunction.register({ ...definitions["getPasswordResetToken"], handler: forward(definitions["getPasswordResetToken"].handler) }),
["getSupportThreadsByUserId"]: RegisteredConvexFunction.register({ ...definitions["getSupportThreadsByUserId"], handler: forward(definitions["getSupportThreadsByUserId"].handler) }),
["health"]: RegisteredConvexFunction.register({ ...definitions["health"], handler: forward(definitions["health"].handler) }),
["recoverSupportNotificationFixture"]: RegisteredConvexFunction.register({ ...definitions["recoverSupportNotificationFixture"], handler: forward(definitions["recoverSupportNotificationFixture"].handler) }),
["resetAiChatFileUploadLimit"]: RegisteredConvexFunction.register({ ...definitions["resetAiChatFileUploadLimit"], handler: forward(definitions["resetAiChatFileUploadLimit"].handler) }),
["seedAiChatHistoryRows"]: RegisteredConvexFunction.register({ ...definitions["seedAiChatHistoryRows"], handler: forward(definitions["seedAiChatHistoryRows"].handler) }),
["seedAuditLogRows"]: RegisteredConvexFunction.register({ ...definitions["seedAuditLogRows"], handler: forward(definitions["seedAuditLogRows"].handler) }),
["seedSupportNotificationClaim"]: RegisteredConvexFunction.register({ ...definitions["seedSupportNotificationClaim"], handler: forward(definitions["seedSupportNotificationClaim"].handler) }),
["verifyTestUserEmail"]: RegisteredConvexFunction.register({ ...definitions["verifyTestUserEmail"], handler: forward(definitions["verifyTestUserEmail"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../tests.spec")["default"]>;
