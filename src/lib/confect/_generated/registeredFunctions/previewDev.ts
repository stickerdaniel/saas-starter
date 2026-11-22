import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../schema";
import groupLayer from "../../previewDev.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../previewDev.spec")["default"]>(databaseSchema, groupLayer);
