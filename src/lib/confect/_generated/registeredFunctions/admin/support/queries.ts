import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/support/queries.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../../admin/support/queries.spec")["default"]>(databaseSchema, groupLayer);

export default {
["getAwaitingResponseCount"]: RegisteredConvexFunction.register({ ...definitions["getAwaitingResponseCount"], handler: forward(definitions["getAwaitingResponseCount"].handler) }),
["getThreadForAdmin"]: RegisteredConvexFunction.register({ ...definitions["getThreadForAdmin"], handler: forward(definitions["getThreadForAdmin"].handler) }),
["listAdmins"]: RegisteredConvexFunction.register({ ...definitions["listAdmins"], handler: forward(definitions["listAdmins"].handler) }),
["listInternalUserNotes"]: RegisteredConvexFunction.register({ ...definitions["listInternalUserNotes"], handler: forward(definitions["listInternalUserNotes"].handler) }),
["listMessageRoutesForAdmin"]: RegisteredConvexFunction.register({ ...definitions["listMessageRoutesForAdmin"], handler: forward(definitions["listMessageRoutesForAdmin"].handler) }),
["listMessagesForAdmin"]: RegisteredConvexFunction.register({ ...definitions["listMessagesForAdmin"], handler: forward(definitions["listMessagesForAdmin"].handler) }),
["listThreadsForAdmin"]: RegisteredConvexFunction.register({ ...definitions["listThreadsForAdmin"], handler: forward(definitions["listThreadsForAdmin"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../../admin/support/queries.spec")["default"]>;
