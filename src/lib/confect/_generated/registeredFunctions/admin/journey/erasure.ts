import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/journey/erasure.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../../admin/journey/erasure.spec")["default"]>(databaseSchema, groupLayer);

export default {
["continueErasure"]: RegisteredConvexFunction.register({ ...definitions["continueErasure"], handler: forward(definitions["continueErasure"].handler) }),
["erasePage"]: RegisteredConvexFunction.register({ ...definitions["erasePage"], handler: forward(definitions["erasePage"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../../admin/journey/erasure.spec")["default"]>;
