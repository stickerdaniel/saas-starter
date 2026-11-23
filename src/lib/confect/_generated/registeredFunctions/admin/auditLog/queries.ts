import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/auditLog/queries.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../../admin/auditLog/queries.spec")["default"]>(databaseSchema, groupLayer);

export default {
["getAuditLogCount"]: RegisteredConvexFunction.register({ ...definitions["getAuditLogCount"], handler: forward(definitions["getAuditLogCount"].handler) }),
["listAuditLogs"]: RegisteredConvexFunction.register({ ...definitions["listAuditLogs"], handler: forward(definitions["listAuditLogs"].handler) }),
["resolveAuditLogLastPage"]: RegisteredConvexFunction.register({ ...definitions["resolveAuditLogLastPage"], handler: forward(definitions["resolveAuditLogLastPage"].handler) }),
["resolveAuditLogUser"]: RegisteredConvexFunction.register({ ...definitions["resolveAuditLogUser"], handler: forward(definitions["resolveAuditLogUser"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../../admin/auditLog/queries.spec")["default"]>;
