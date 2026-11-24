import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../admin/queries.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../admin/queries.spec")["default"]>(databaseSchema, groupLayer);

export default {
["getDashboardMetrics"]: RegisteredConvexFunction.register({ ...definitions["getDashboardMetrics"], handler: forward(definitions["getDashboardMetrics"].handler) }),
["getUserCount"]: RegisteredConvexFunction.register({ ...definitions["getUserCount"], handler: forward(definitions["getUserCount"].handler) }),
["listUsers"]: RegisteredConvexFunction.register({ ...definitions["listUsers"], handler: forward(definitions["listUsers"].handler) }),
["resolveUsersLastPage"]: RegisteredConvexFunction.register({ ...definitions["resolveUsersLastPage"], handler: forward(definitions["resolveUsersLastPage"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../admin/queries.spec")["default"]>;
