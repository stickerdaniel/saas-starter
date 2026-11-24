import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../admin/mutations.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../admin/mutations.spec")["default"]>(databaseSchema, groupLayer);

export default {
["banUser"]: RegisteredConvexFunction.register({ ...definitions["banUser"], handler: forward(definitions["banUser"].handler) }),
["revokeUserSessions"]: RegisteredConvexFunction.register({ ...definitions["revokeUserSessions"], handler: forward(definitions["revokeUserSessions"].handler) }),
["seedFirstAdmin"]: RegisteredConvexFunction.register({ ...definitions["seedFirstAdmin"], handler: forward(definitions["seedFirstAdmin"].handler) }),
["setUserRole"]: RegisteredConvexFunction.register({ ...definitions["setUserRole"], handler: forward(definitions["setUserRole"].handler) }),
["unbanUser"]: RegisteredConvexFunction.register({ ...definitions["unbanUser"], handler: forward(definitions["unbanUser"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../admin/mutations.spec")["default"]>;
