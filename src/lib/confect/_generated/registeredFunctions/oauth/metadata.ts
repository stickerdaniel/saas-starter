import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../oauth/metadata.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../oauth/metadata.spec")["default"]>(databaseSchema, groupLayer);

export default {
["authorizationServer"]: RegisteredConvexFunction.register({ ...definitions["authorizationServer"], handler: forward(definitions["authorizationServer"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../oauth/metadata.spec")["default"]>;
