import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../aiUsage/record.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../aiUsage/record.spec")["default"]>(databaseSchema, groupLayer);

export default {
["insert"]: RegisteredConvexFunction.register({ ...definitions["insert"], handler: forward(definitions["insert"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../aiUsage/record.spec")["default"]>;
