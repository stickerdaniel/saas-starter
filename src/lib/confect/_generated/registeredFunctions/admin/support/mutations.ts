import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/support/mutations.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../../admin/support/mutations.spec")["default"]>(databaseSchema, groupLayer);

export default {
["addInternalUserNote"]: RegisteredConvexFunction.register({ ...definitions["addInternalUserNote"], handler: forward(definitions["addInternalUserNote"].handler) }),
["sendAdminReply"]: RegisteredConvexFunction.register({ ...definitions["sendAdminReply"], handler: forward(definitions["sendAdminReply"].handler) }),
["updateThreadAssignment"]: RegisteredConvexFunction.register({ ...definitions["updateThreadAssignment"], handler: forward(definitions["updateThreadAssignment"].handler) }),
["updateThreadPriority"]: RegisteredConvexFunction.register({ ...definitions["updateThreadPriority"], handler: forward(definitions["updateThreadPriority"].handler) }),
["updateThreadStatus"]: RegisteredConvexFunction.register({ ...definitions["updateThreadStatus"], handler: forward(definitions["updateThreadStatus"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../../admin/support/mutations.spec")["default"]>;
