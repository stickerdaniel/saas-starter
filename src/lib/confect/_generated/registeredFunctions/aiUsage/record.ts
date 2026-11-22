import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../aiUsage/record.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../aiUsage/record.spec")["default"]>(databaseSchema, groupLayer);
