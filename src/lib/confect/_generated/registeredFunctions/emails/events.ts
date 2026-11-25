import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../emails/events.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../emails/events.spec")["default"]>(databaseSchema, groupLayer);

export default {
["handleEmailEvent"]: RegisteredConvexFunction.register({ ...definitions["handleEmailEvent"], handler: forward(definitions["handleEmailEvent"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../emails/events.spec")["default"]>;
