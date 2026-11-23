import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/notificationPreferences/mutations.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../../admin/notificationPreferences/mutations.spec")["default"]>(databaseSchema, groupLayer);

export default {
["addCustomEmail"]: RegisteredConvexFunction.register({ ...definitions["addCustomEmail"], handler: forward(definitions["addCustomEmail"].handler) }),
["removeCustomEmail"]: RegisteredConvexFunction.register({ ...definitions["removeCustomEmail"], handler: forward(definitions["removeCustomEmail"].handler) }),
["syncAllAdminPreferences"]: RegisteredConvexFunction.register({ ...definitions["syncAllAdminPreferences"], handler: forward(definitions["syncAllAdminPreferences"].handler) }),
["updatePreference"]: RegisteredConvexFunction.register({ ...definitions["updatePreference"], handler: forward(definitions["updatePreference"].handler) }),
["updatePreferences"]: RegisteredConvexFunction.register({ ...definitions["updatePreferences"], handler: forward(definitions["updatePreferences"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../../admin/notificationPreferences/mutations.spec")["default"]>;
