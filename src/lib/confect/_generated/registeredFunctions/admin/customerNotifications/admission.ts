import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/customerNotifications/admission.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../../admin/customerNotifications/admission.spec")["default"]>(databaseSchema, groupLayer);

export default {
["admitObservation"]: RegisteredConvexFunction.register({ ...definitions["admitObservation"], handler: forward(definitions["admitObservation"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../../admin/customerNotifications/admission.spec")["default"]>;
