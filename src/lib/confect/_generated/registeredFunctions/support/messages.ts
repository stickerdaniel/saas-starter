import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../support/messages.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../support/messages.spec")["default"]>(databaseSchema, groupLayer);
