import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../emails/founderIncidentSend.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../emails/founderIncidentSend.spec")["default"]>(databaseSchema, groupLayer);

export default {
["queueFounderIncidentEmail"]: RegisteredConvexFunction.register({ ...definitions["queueFounderIncidentEmail"], handler: forward(definitions["queueFounderIncidentEmail"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../emails/founderIncidentSend.spec")["default"]>;
