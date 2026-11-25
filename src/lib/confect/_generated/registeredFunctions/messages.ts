import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../schema";
import groupLayer from "../../messages.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../messages.spec")["default"]>(databaseSchema, groupLayer);

export default {
["enforceAndTrackMessageUsage"]: RegisteredConvexFunction.register({ ...definitions["enforceAndTrackMessageUsage"], handler: forward(definitions["enforceAndTrackMessageUsage"].handler) }),
["list"]: RegisteredConvexFunction.register({ ...definitions["list"], handler: forward(definitions["list"].handler) }),
["markMessageSettled"]: RegisteredConvexFunction.register({ ...definitions["markMessageSettled"], handler: forward(definitions["markMessageSettled"].handler) }),
["removeMessage"]: RegisteredConvexFunction.register({ ...definitions["removeMessage"], handler: forward(definitions["removeMessage"].handler) }),
["send"]: RegisteredConvexFunction.register({ ...definitions["send"], handler: forward(definitions["send"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../messages.spec")["default"]>;
