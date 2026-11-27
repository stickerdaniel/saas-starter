import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../oauth/connections.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../oauth/connections.spec")["default"]>(databaseSchema, groupLayer);

export default {
["epoch"]: RegisteredConvexFunction.register({ ...definitions["epoch"], handler: forward(definitions["epoch"].handler) }),
["list"]: RegisteredConvexFunction.register({ ...definitions["list"], handler: forward(definitions["list"].handler) }),
["endpoint"]: RegisteredConvexFunction.register({ ...definitions["endpoint"], handler: forward(definitions["endpoint"].handler) }),
["recordUse"]: RegisteredConvexFunction.register({ ...definitions["recordUse"], handler: forward(definitions["recordUse"].handler) }),
["revoke"]: RegisteredConvexFunction.register({ ...definitions["revoke"], handler: forward(definitions["revoke"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../oauth/connections.spec")["default"]>;
