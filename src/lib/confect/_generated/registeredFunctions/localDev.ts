import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../schema";
import groupLayer from "../../localDev.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../localDev.spec")["default"]>(databaseSchema, groupLayer);

export default {
["ensureSeededAdmin"]: RegisteredConvexFunction.register({ ...definitions["ensureSeededAdmin"], handler: forward(definitions["ensureSeededAdmin"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../localDev.spec")["default"]>;
