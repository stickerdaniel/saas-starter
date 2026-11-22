import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../aiChat/activityMigration.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../aiChat/activityMigration.spec")["default"]>(databaseSchema, groupLayer);
