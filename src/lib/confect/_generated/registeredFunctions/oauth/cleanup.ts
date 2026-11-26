import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../oauth/cleanup.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../oauth/cleanup.spec")["default"]>(databaseSchema, groupLayer);

export default {
["deleteStaleClients"]: RegisteredConvexFunction.register({ ...definitions["deleteStaleClients"], handler: forward(definitions["deleteStaleClients"].handler) }),
["deleteExpiredTokens"]: RegisteredConvexFunction.register({ ...definitions["deleteExpiredTokens"], handler: forward(definitions["deleteExpiredTokens"].handler) }),
["eraseUserGrants"]: RegisteredConvexFunction.register({ ...definitions["eraseUserGrants"], handler: forward(definitions["eraseUserGrants"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../oauth/cleanup.spec")["default"]>;
