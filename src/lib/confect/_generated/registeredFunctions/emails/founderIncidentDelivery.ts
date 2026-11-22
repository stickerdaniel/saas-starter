import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../schema";
import groupLayer from "../../../emails/founderIncidentDelivery.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../emails/founderIncidentDelivery.spec")["default"]>(databaseSchema, groupLayer);
