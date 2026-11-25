import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../emails/founderEmails.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../emails/founderEmails.spec")["default"]>(databaseSchema, groupLayer);

export default {
["recordFounderEmailSendFailure"]: RegisteredConvexFunction.register({ ...definitions["recordFounderEmailSendFailure"], handler: forward(definitions["recordFounderEmailSendFailure"].handler) }),
["sendFounderCancellationEmail"]: RegisteredConvexFunction.register({ ...definitions["sendFounderCancellationEmail"], handler: forward(definitions["sendFounderCancellationEmail"].handler) }),
["sendFounderFeedbackEmail"]: RegisteredConvexFunction.register({ ...definitions["sendFounderFeedbackEmail"], handler: forward(definitions["sendFounderFeedbackEmail"].handler) }),
["setPersonalEmailSuppression"]: RegisteredConvexFunction.register({ ...definitions["setPersonalEmailSuppression"], handler: forward(definitions["setPersonalEmailSuppression"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../emails/founderEmails.spec")["default"]>;
