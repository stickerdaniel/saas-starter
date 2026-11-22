import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../support/files.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../support/files.spec")["default"]>(databaseSchema, groupLayer);
