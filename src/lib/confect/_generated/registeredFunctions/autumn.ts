import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../schema";
import groupLayer from "../../autumn.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../autumn.spec")["default"]>(databaseSchema, groupLayer);
