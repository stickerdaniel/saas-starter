import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/customerNotifications/admission.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../../admin/customerNotifications/admission.spec")["default"]>(databaseSchema, groupLayer);
