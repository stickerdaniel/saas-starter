import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../aiChat/messages.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../aiChat/messages.spec")["default"]>(databaseSchema, groupLayer);
