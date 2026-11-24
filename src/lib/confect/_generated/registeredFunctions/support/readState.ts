import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../support/readState.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../support/readState.spec")["default"]>(databaseSchema, groupLayer);

export default {
["hasUnreadAdminReply"]: RegisteredConvexFunction.register({ ...definitions["hasUnreadAdminReply"], handler: forward(definitions["hasUnreadAdminReply"].handler) }),
["markThreadRead"]: RegisteredConvexFunction.register({ ...definitions["markThreadRead"], handler: forward(definitions["markThreadRead"].handler) }),
["unreadAdminReplyCount"]: RegisteredConvexFunction.register({ ...definitions["unreadAdminReplyCount"], handler: forward(definitions["unreadAdminReplyCount"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../support/readState.spec")["default"]>;
