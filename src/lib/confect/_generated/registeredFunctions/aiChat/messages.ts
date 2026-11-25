import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../aiChat/messages.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../aiChat/messages.spec")["default"]>(databaseSchema, groupLayer);

export default {
["createAIResponse"]: RegisteredConvexFunction.register({ ...definitions["createAIResponse"], handler: forward(definitions["createAIResponse"].handler) }),
["getFileMetadataBatch"]: RegisteredConvexFunction.register({ ...definitions["getFileMetadataBatch"], handler: forward(definitions["getFileMetadataBatch"].handler) }),
["listMessages"]: RegisteredConvexFunction.register({ ...definitions["listMessages"], handler: forward(definitions["listMessages"].handler) }),
["sendMessage"]: RegisteredConvexFunction.register({ ...definitions["sendMessage"], handler: forward(definitions["sendMessage"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../aiChat/messages.spec")["default"]>;
