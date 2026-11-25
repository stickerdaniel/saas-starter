import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../emails/founderEmailBilling.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../emails/founderEmailBilling.spec")["default"]>(databaseSchema, groupLayer);

export default {
["resolveFounderCancellationBilling"]: RegisteredConvexFunction.register({ ...definitions["resolveFounderCancellationBilling"], handler: forward(definitions["resolveFounderCancellationBilling"].handler) }),
["resolveFounderFeedbackBilling"]: RegisteredConvexFunction.register({ ...definitions["resolveFounderFeedbackBilling"], handler: forward(definitions["resolveFounderFeedbackBilling"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../emails/founderEmailBilling.spec")["default"]>;
