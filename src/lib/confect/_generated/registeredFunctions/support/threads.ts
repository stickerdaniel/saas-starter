import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../support/threads.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../support/threads.spec")["default"]>(databaseSchema, groupLayer);

export default {
["backfillThreadMetadata"]: RegisteredConvexFunction.register({ ...definitions["backfillThreadMetadata"], handler: forward(definitions["backfillThreadMetadata"].handler) }),
["createThread"]: RegisteredConvexFunction.register({ ...definitions["createThread"], handler: forward(definitions["createThread"].handler) }),
["deleteEmptyThreads"]: RegisteredConvexFunction.register({ ...definitions["deleteEmptyThreads"], handler: forward(definitions["deleteEmptyThreads"].handler) }),
["getAdminAvatars"]: RegisteredConvexFunction.register({ ...definitions["getAdminAvatars"], handler: forward(definitions["getAdminAvatars"].handler) }),
["getOrCreateWarmThread"]: RegisteredConvexFunction.register({ ...definitions["getOrCreateWarmThread"], handler: forward(definitions["getOrCreateWarmThread"].handler) }),
["getThread"]: RegisteredConvexFunction.register({ ...definitions["getThread"], handler: forward(definitions["getThread"].handler) }),
["getThreadLocale"]: RegisteredConvexFunction.register({ ...definitions["getThreadLocale"], handler: forward(definitions["getThreadLocale"].handler) }),
["listThreads"]: RegisteredConvexFunction.register({ ...definitions["listThreads"], handler: forward(definitions["listThreads"].handler) }),
["sweepEmptyThread"]: RegisteredConvexFunction.register({ ...definitions["sweepEmptyThread"], handler: forward(definitions["sweepEmptyThread"].handler) }),
["syncUserProfile"]: RegisteredConvexFunction.register({ ...definitions["syncUserProfile"], handler: forward(definitions["syncUserProfile"].handler) }),
["updateLastMessage"]: RegisteredConvexFunction.register({ ...definitions["updateLastMessage"], handler: forward(definitions["updateLastMessage"].handler) }),
["updateNotificationEmail"]: RegisteredConvexFunction.register({ ...definitions["updateNotificationEmail"], handler: forward(definitions["updateNotificationEmail"].handler) }),
["updateThreadHandoff"]: RegisteredConvexFunction.register({ ...definitions["updateThreadHandoff"], handler: forward(definitions["updateThreadHandoff"].handler) }),
["updateThreadMetadata"]: RegisteredConvexFunction.register({ ...definitions["updateThreadMetadata"], handler: forward(definitions["updateThreadMetadata"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../support/threads.spec")["default"]>;
