import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../support/handoff.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../support/handoff.spec")["default"]>(databaseSchema, groupLayer);
