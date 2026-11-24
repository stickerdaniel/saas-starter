import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/founderWelcome/queries.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../../admin/founderWelcome/queries.spec")["default"]>(databaseSchema, groupLayer);

export default {
["getFounderEmailSettings"]: RegisteredConvexFunction.register({ ...definitions["getFounderEmailSettings"], handler: forward(definitions["getFounderEmailSettings"].handler) }),
["getFounderWelcomeConfig"]: RegisteredConvexFunction.register({ ...definitions["getFounderWelcomeConfig"], handler: forward(definitions["getFounderWelcomeConfig"].handler) }),
["getFounderWelcomeConfigInternal"]: RegisteredConvexFunction.register({ ...definitions["getFounderWelcomeConfigInternal"], handler: forward(definitions["getFounderWelcomeConfigInternal"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../../admin/founderWelcome/queries.spec")["default"]>;
