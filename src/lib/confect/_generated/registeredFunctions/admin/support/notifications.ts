import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/support/notifications.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../../admin/support/notifications.spec")["default"]>(databaseSchema, groupLayer);

export default {
["cancelPendingNotification"]: RegisteredConvexFunction.register({ ...definitions["cancelPendingNotification"], handler: forward(definitions["cancelPendingNotification"].handler) }),
["claimNotificationForSending"]: RegisteredConvexFunction.register({ ...definitions["claimNotificationForSending"], handler: forward(definitions["claimNotificationForSending"].handler) }),
["deletePendingNotification"]: RegisteredConvexFunction.register({ ...definitions["deletePendingNotification"], handler: forward(definitions["deletePendingNotification"].handler) }),
["getMessageContents"]: RegisteredConvexFunction.register({ ...definitions["getMessageContents"], handler: forward(definitions["getMessageContents"].handler) }),
["getNotificationTargetEmails"]: RegisteredConvexFunction.register({ ...definitions["getNotificationTargetEmails"], handler: forward(definitions["getNotificationTargetEmails"].handler) }),
["getRecentUserMessages"]: RegisteredConvexFunction.register({ ...definitions["getRecentUserMessages"], handler: forward(definitions["getRecentUserMessages"].handler) }),
["getSupportThread"]: RegisteredConvexFunction.register({ ...definitions["getSupportThread"], handler: forward(definitions["getSupportThread"].handler) }),
["listLegacyNotificationClaims"]: RegisteredConvexFunction.register({ ...definitions["listLegacyNotificationClaims"], handler: forward(definitions["listLegacyNotificationClaims"].handler) }),
["recoverNotificationClaim"]: RegisteredConvexFunction.register({ ...definitions["recoverNotificationClaim"], handler: forward(definitions["recoverNotificationClaim"].handler) }),
["reschedulePendingNotification"]: RegisteredConvexFunction.register({ ...definitions["reschedulePendingNotification"], handler: forward(definitions["reschedulePendingNotification"].handler) }),
["scheduleAdminNotification"]: RegisteredConvexFunction.register({ ...definitions["scheduleAdminNotification"], handler: forward(definitions["scheduleAdminNotification"].handler) }),
["sendPendingAdminNotification"]: RegisteredConvexFunction.register({ ...definitions["sendPendingAdminNotification"], handler: forward(definitions["sendPendingAdminNotification"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../../admin/support/notifications.spec")["default"]>;
