import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/notificationPreferences/queries.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../../admin/notificationPreferences/queries.spec")["default"]>(databaseSchema, groupLayer);

export default {
["getJourneyRecipients"]: RegisteredConvexFunction.register({ ...definitions["getJourneyRecipients"], handler: forward(definitions["getJourneyRecipients"].handler) }),
["getNotificationRecipientCount"]: RegisteredConvexFunction.register({ ...definitions["getNotificationRecipientCount"], handler: forward(definitions["getNotificationRecipientCount"].handler) }),
["getRecipientsForNotificationType"]: RegisteredConvexFunction.register({ ...definitions["getRecipientsForNotificationType"], handler: forward(definitions["getRecipientsForNotificationType"].handler) }),
["listNotificationRecipients"]: RegisteredConvexFunction.register({ ...definitions["listNotificationRecipients"], handler: forward(definitions["listNotificationRecipients"].handler) }),
["resolveNotificationRecipientsLastPage"]: RegisteredConvexFunction.register({ ...definitions["resolveNotificationRecipientsLastPage"], handler: forward(definitions["resolveNotificationRecipientsLastPage"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../../admin/notificationPreferences/queries.spec")["default"]>;
