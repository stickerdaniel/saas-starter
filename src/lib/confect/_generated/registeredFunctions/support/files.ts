import { ConvexFunctionDefinitions, RegisteredConvexFunction, type RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../support/files.impl";

const forward = <Ctx, Args, Returns>(handler: (ctx: Ctx, args: Args) => Promise<Returns>) => (ctx: Ctx, args: Args) => handler(ctx, args);

const definitions = ConvexFunctionDefinitions.buildForGroup<typeof import("../../../support/files.spec")["default"]>(databaseSchema, groupLayer);

export default {
["checkPreviewAccess"]: RegisteredConvexFunction.register({ ...definitions["checkPreviewAccess"], handler: forward(definitions["checkPreviewAccess"].handler) }),
["generateUploadUrl"]: RegisteredConvexFunction.register({ ...definitions["generateUploadUrl"], handler: forward(definitions["generateUploadUrl"].handler) }),
["getAttachmentText"]: RegisteredConvexFunction.register({ ...definitions["getAttachmentText"], handler: forward(definitions["getAttachmentText"].handler) }),
["saveUploadedFile"]: RegisteredConvexFunction.register({ ...definitions["saveUploadedFile"], handler: forward(definitions["saveUploadedFile"].handler) }),
} as RegisteredFunctions.RegisteredFunctionsForGroupSpec<typeof import("../../../support/files.spec")["default"]>;
