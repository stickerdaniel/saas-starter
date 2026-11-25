import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../aiChat/threads.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../aiChat/threads.spec")["default"]>(databaseSchema, groupLayer);

export default {
["backfillThreadMetadata"]: RegisteredConvexFunction.register({ ...definitions["backfillThreadMetadata"], handler: forward(definitions["backfillThreadMetadata"].handler) }),
["createThread"]: RegisteredConvexFunction.register({ ...definitions["createThread"], handler: forward(definitions["createThread"].handler) }),
["deleteStaleWarmThreads"]: RegisteredConvexFunction.register({ ...definitions["deleteStaleWarmThreads"], handler: forward(definitions["deleteStaleWarmThreads"].handler) }),
["deleteThread"]: RegisteredConvexFunction.register({ ...definitions["deleteThread"], handler: forward(definitions["deleteThread"].handler) }),
["getOrCreateWarmThread"]: RegisteredConvexFunction.register({ ...definitions["getOrCreateWarmThread"], handler: forward(definitions["getOrCreateWarmThread"].handler) }),
["getWarmThread"]: RegisteredConvexFunction.register({ ...definitions["getWarmThread"], handler: forward(definitions["getWarmThread"].handler) }),
["listThreads"]: RegisteredConvexFunction.register({ ...definitions["listThreads"], handler: forward(definitions["listThreads"].handler) }),
["setThreadTitleIfEmpty"]: RegisteredConvexFunction.register({ ...definitions["setThreadTitleIfEmpty"], handler: forward(definitions["setThreadTitleIfEmpty"].handler) }),
["updateThreadMetadata"]: RegisteredConvexFunction.register({ ...definitions["updateThreadMetadata"], handler: forward(definitions["updateThreadMetadata"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../aiChat/threads.spec")["default"]>;
