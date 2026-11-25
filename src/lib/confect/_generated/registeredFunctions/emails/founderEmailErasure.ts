import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../emails/founderEmailErasure.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../emails/founderEmailErasure.spec")["default"]>(databaseSchema, groupLayer);

export default {
["continueFounderEmailErasure"]: RegisteredConvexFunction.register({ ...definitions["continueFounderEmailErasure"], handler: forward(definitions["continueFounderEmailErasure"].handler) }),
["eraseFounderEmailPage"]: RegisteredConvexFunction.register({ ...definitions["eraseFounderEmailPage"], handler: forward(definitions["eraseFounderEmailPage"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../emails/founderEmailErasure.spec")["default"]>;
