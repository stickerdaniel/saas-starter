import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../emails/founderEmailBilling.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../emails/founderEmailBilling.spec")["default"]>(databaseSchema, groupLayer);
