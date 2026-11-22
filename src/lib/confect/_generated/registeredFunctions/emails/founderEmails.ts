import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../emails/founderEmails.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../emails/founderEmails.spec")["default"]>(databaseSchema, groupLayer);
