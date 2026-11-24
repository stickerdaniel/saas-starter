import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../support/migration.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../support/migration.spec")["default"]>(databaseSchema, groupLayer);

export default {
["migrateAnonymousTickets"]: RegisteredConvexFunction.register({ ...definitions["migrateAnonymousTickets"], handler: forward(definitions["migrateAnonymousTickets"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../support/migration.spec")["default"]>;
