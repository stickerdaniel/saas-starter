import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/customerNotifications/cancel.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../../admin/customerNotifications/cancel.spec")["default"]>(databaseSchema, groupLayer);

export default {
["cancelUnsentEmails"]: RegisteredConvexFunction.register({ ...definitions["cancelUnsentEmails"], handler: forward(definitions["cancelUnsentEmails"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../../admin/customerNotifications/cancel.spec")["default"]>;
