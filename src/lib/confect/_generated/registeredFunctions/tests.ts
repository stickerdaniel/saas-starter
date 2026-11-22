import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../schema";
import groupLayer from "../../tests.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../tests.spec")["default"]>(databaseSchema, groupLayer);
