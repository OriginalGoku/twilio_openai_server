import { checkAvailabilityTool } from "./check-availability.js";
import { scheduleMeetingTool } from "./schedule-meeting.js";
import { sendEmailTool } from "./send-email.js";
import { sendSmsTool } from "./send-sms.js";

export const agentTools = [scheduleMeetingTool, checkAvailabilityTool, sendSmsTool, sendEmailTool];
