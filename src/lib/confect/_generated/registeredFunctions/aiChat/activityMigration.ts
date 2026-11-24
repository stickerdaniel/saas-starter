import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../aiChat/activityMigration.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../aiChat/activityMigration.spec")["default"]>(databaseSchema, groupLayer);

export default {
["runPage"]: RegisteredConvexFunction.register({ ...definitions["runPage"], handler: forward(definitions["runPage"].handler) }),
["start"]: RegisteredConvexFunction.register({ ...definitions["start"], handler: forward(definitions["start"].handler) }),
["status"]: RegisteredConvexFunction.register({ ...definitions["status"], handler: forward(definitions["status"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../aiChat/activityMigration.spec")["default"]>;
