import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../schema";
import groupLayer from "../../users.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../users.spec")["default"]>(databaseSchema, groupLayer);

export default {
["dismissPasskeyNudge"]: RegisteredConvexFunction.register({ ...definitions["dismissPasskeyNudge"], handler: forward(definitions["dismissPasskeyNudge"].handler) }),
["getPasskeyNudgeDismissal"]: RegisteredConvexFunction.register({ ...definitions["getPasskeyNudgeDismissal"], handler: forward(definitions["getPasskeyNudgeDismissal"].handler) }),
["hasPassword"]: RegisteredConvexFunction.register({ ...definitions["hasPassword"], handler: forward(definitions["hasPassword"].handler) }),
["setPassword"]: RegisteredConvexFunction.register({ ...definitions["setPassword"], handler: forward(definitions["setPassword"].handler) }),
["viewer"]: RegisteredConvexFunction.register({ ...definitions["viewer"], handler: forward(definitions["viewer"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../users.spec")["default"]>;
