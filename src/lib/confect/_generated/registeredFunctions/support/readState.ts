import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../support/readState.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../support/readState.spec")["default"]>(databaseSchema, groupLayer);
