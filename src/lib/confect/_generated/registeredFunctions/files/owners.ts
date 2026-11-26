import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../files/owners.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../files/owners.spec")["default"]>(databaseSchema, groupLayer);

export default {
["grantFileOwner"]: RegisteredConvexFunction.register({ ...definitions["grantFileOwner"], handler: forward(definitions["grantFileOwner"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../files/owners.spec")["default"]>;
