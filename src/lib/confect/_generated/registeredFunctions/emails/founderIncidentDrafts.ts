import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../emails/founderIncidentDrafts.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../emails/founderIncidentDrafts.spec")["default"]>(databaseSchema, groupLayer);
