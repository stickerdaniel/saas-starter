import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/notificationPreferences/mutations.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../../admin/notificationPreferences/mutations.spec")["default"]>(databaseSchema, groupLayer);
