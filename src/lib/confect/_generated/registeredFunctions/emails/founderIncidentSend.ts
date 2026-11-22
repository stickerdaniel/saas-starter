import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../emails/founderIncidentSend.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../emails/founderIncidentSend.spec")["default"]>(databaseSchema, groupLayer);
