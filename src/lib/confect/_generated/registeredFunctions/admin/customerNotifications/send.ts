import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/customerNotifications/send.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../../admin/customerNotifications/send.spec")["default"]>(databaseSchema, groupLayer);

export default {
["enqueueRecipient"]: RegisteredConvexFunction.register({ ...definitions["enqueueRecipient"], handler: forward(definitions["enqueueRecipient"].handler) }),
["sendCancellation"]: RegisteredConvexFunction.register({ ...definitions["sendCancellation"], handler: forward(definitions["sendCancellation"].handler) }),
["sendNewCustomer"]: RegisteredConvexFunction.register({ ...definitions["sendNewCustomer"], handler: forward(definitions["sendNewCustomer"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../../admin/customerNotifications/send.spec")["default"]>;
