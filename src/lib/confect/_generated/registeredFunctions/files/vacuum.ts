import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../files/vacuum.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../files/vacuum.spec")["default"]>(databaseSchema, groupLayer);

export default {
["deleteUnusedFiles"]: RegisteredConvexFunction.register({ ...definitions["deleteUnusedFiles"], handler: forward(definitions["deleteUnusedFiles"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../files/vacuum.spec")["default"]>;
