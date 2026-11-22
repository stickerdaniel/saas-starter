import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/notificationPreferences/queries.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../../admin/notificationPreferences/queries.spec")["default"]>(databaseSchema, groupLayer);
