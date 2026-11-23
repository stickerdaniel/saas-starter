import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/support/notificationDelivery.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../../admin/support/notificationDelivery.spec")["default"]>(databaseSchema, groupLayer);

export default {
["cleanupReceipts"]: RegisteredConvexFunction.register({ ...definitions["cleanupReceipts"], handler: forward(definitions["cleanupReceipts"].handler) }),
["enqueueRecipient"]: RegisteredConvexFunction.register({ ...definitions["enqueueRecipient"], handler: forward(definitions["enqueueRecipient"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../../admin/support/notificationDelivery.spec")["default"]>;
