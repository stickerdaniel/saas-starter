import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../aiChat/files.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../aiChat/files.spec")["default"]>(databaseSchema, groupLayer);
