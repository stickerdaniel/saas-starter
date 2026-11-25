import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../files/metadata.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../files/metadata.spec")["default"]>(databaseSchema, groupLayer);

export default {
["storeFileMetadata"]: RegisteredConvexFunction.register({ ...definitions["storeFileMetadata"], handler: forward(definitions["storeFileMetadata"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../files/metadata.spec")["default"]>;
