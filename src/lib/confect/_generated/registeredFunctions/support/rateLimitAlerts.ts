import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../support/rateLimitAlerts.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../support/rateLimitAlerts.spec")["default"]>(databaseSchema, groupLayer);

export default {
["sampleAnonymousRateLimits"]: RegisteredConvexFunction.register({ ...definitions["sampleAnonymousRateLimits"], handler: forward(definitions["sampleAnonymousRateLimits"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../support/rateLimitAlerts.spec")["default"]>;
