import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../support/rateLimitAlerts.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../support/rateLimitAlerts.spec")["default"]>(databaseSchema, groupLayer);
