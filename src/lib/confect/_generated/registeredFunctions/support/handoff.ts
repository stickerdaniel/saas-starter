import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../support/handoff.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../support/handoff.spec")["default"]>(databaseSchema, groupLayer);

export default {
["internalSetHandoff"]: RegisteredConvexFunction.register({ ...definitions["internalSetHandoff"], handler: forward(definitions["internalSetHandoff"].handler) }),
["settleUnansweredTurn"]: RegisteredConvexFunction.register({ ...definitions["settleUnansweredTurn"], handler: forward(definitions["settleUnansweredTurn"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../support/handoff.spec")["default"]>;
