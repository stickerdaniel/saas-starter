import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../support/promptStore.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../support/promptStore.spec")["default"]>(databaseSchema, groupLayer);
