import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../emails/founderIncidentDelivery.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../emails/founderIncidentDelivery.spec")["default"]>(databaseSchema, groupLayer);

export default {
["reconcileFounderIncidentEmailDelivery"]: RegisteredConvexFunction.register({ ...definitions["reconcileFounderIncidentEmailDelivery"], handler: forward(definitions["reconcileFounderIncidentEmailDelivery"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../emails/founderIncidentDelivery.spec")["default"]>;
