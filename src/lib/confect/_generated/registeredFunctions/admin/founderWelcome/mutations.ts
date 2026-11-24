import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/founderWelcome/mutations.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../../admin/founderWelcome/mutations.spec")["default"]>(databaseSchema, groupLayer);

export default {
["setFounderEmailEnabled"]: RegisteredConvexFunction.register({ ...definitions["setFounderEmailEnabled"], handler: forward(definitions["setFounderEmailEnabled"].handler) }),
["stepDown"]: RegisteredConvexFunction.register({ ...definitions["stepDown"], handler: forward(definitions["stepDown"].handler) }),
["updateConfig"]: RegisteredConvexFunction.register({ ...definitions["updateConfig"], handler: forward(definitions["updateConfig"].handler) }),
["updateFounderEmailTemplate"]: RegisteredConvexFunction.register({ ...definitions["updateFounderEmailTemplate"], handler: forward(definitions["updateFounderEmailTemplate"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../../admin/founderWelcome/mutations.spec")["default"]>;
