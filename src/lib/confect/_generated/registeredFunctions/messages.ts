import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../schema";
import groupLayer from "../../messages.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../messages.spec")["default"]>(databaseSchema, groupLayer);
