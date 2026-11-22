import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../emails/founderEmailLedger.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../emails/founderEmailLedger.spec")["default"]>(databaseSchema, groupLayer);
