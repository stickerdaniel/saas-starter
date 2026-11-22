import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../support/migration.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../support/migration.spec")["default"]>(databaseSchema, groupLayer);
