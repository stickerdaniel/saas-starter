import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../files/cleanup.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../files/cleanup.spec")["default"]>(databaseSchema, groupLayer);

export default {
["cleanupExpiredFiles"]: RegisteredConvexFunction.register({ ...definitions["cleanupExpiredFiles"], handler: forward(definitions["cleanupExpiredFiles"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../files/cleanup.spec")["default"]>;
