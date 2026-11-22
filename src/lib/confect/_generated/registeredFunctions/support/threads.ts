import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../support/threads.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../support/threads.spec")["default"]>(databaseSchema, groupLayer);
