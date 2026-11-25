import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../emails/send.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../emails/send.spec")["default"]>(databaseSchema, groupLayer);

export default {
["sendAdminReplyNotification"]: RegisteredConvexFunction.register({ ...definitions["sendAdminReplyNotification"], handler: forward(definitions["sendAdminReplyNotification"].handler) }),
["sendFounderWelcomeEmail"]: RegisteredConvexFunction.register({ ...definitions["sendFounderWelcomeEmail"], handler: forward(definitions["sendFounderWelcomeEmail"].handler) }),
["sendNewTicketAdminNotification"]: RegisteredConvexFunction.register({ ...definitions["sendNewTicketAdminNotification"], handler: forward(definitions["sendNewTicketAdminNotification"].handler) }),
["sendNewUserSignupNotification"]: RegisteredConvexFunction.register({ ...definitions["sendNewUserSignupNotification"], handler: forward(definitions["sendNewUserSignupNotification"].handler) }),
["sendResetPasswordEmail"]: RegisteredConvexFunction.register({ ...definitions["sendResetPasswordEmail"], handler: forward(definitions["sendResetPasswordEmail"].handler) }),
["sendVerificationEmail"]: RegisteredConvexFunction.register({ ...definitions["sendVerificationEmail"], handler: forward(definitions["sendVerificationEmail"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../emails/send.spec")["default"]>;
