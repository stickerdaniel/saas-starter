import { RegisteredFunctions } from "@confect/server";
import databaseSchema from "../../../schema";
import groupLayer from "../../../../admin/support/notificationDelivery.impl";

export default RegisteredFunctions.buildForGroup<typeof import("../../../../admin/support/notificationDelivery.spec")["default"]>(databaseSchema, groupLayer);
