import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../aiChat/titles.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../aiChat/titles.spec")["default"]>(databaseSchema, groupLayer);
