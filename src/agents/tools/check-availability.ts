import { tool } from "@openai/agents";
import { google } from "googleapis";
import { z } from "zod";

import { config } from "../../config/env.js";

const authClient =
  config.ENABLE_CALENDAR_TOOLS && config.GOOGLE_CLIENT_EMAIL && config.GOOGLE_PRIVATE_KEY
    ? new google.auth.JWT({
        email: config.GOOGLE_CLIENT_EMAIL,
        key: config.GOOGLE_PRIVATE_KEY,
        scopes: ["https://www.googleapis.com/auth/calendar.readonly"]
      })
    : null;

const calendar = authClient ? google.calendar({ version: "v3", auth: authClient }) : null;

function getDayRange(date: string): { start: Date; end: Date } {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(`${date}T23:59:59`);
  return { start, end };
}

function generateSlots(date: string): Date[] {
  const slots: Date[] = [];
  for (let hour = config.WORKDAY_START_HOUR; hour < config.WORKDAY_END_HOUR; hour += 1) {
    slots.push(new Date(`${date}T${String(hour).padStart(2, "0")}:00:00`));
    slots.push(new Date(`${date}T${String(hour).padStart(2, "0")}:30:00`));
  }
  return slots;
}

function overlaps(slotStart: Date, busyStart: Date, busyEnd: Date): boolean {
  const slotEnd = new Date(slotStart.getTime() + 30 * 60 * 1000);
  return slotStart < busyEnd && slotEnd > busyStart;
}

export const checkAvailabilityTool = tool({
  name: "check_availability",
  description: "Check available appointment slots for a specific date. Use this when the caller asks when they can book.",
  parameters: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  }),
  async execute({ date }) {
    if (!config.ENABLE_CALENDAR_TOOLS || !calendar || !config.GOOGLE_CALENDAR_ID) {
      return { error: "Calendar tool is not enabled" };
    }

    try {
      const { start, end } = getDayRange(date);
      const freebusy = await calendar.freebusy.query({
        requestBody: {
          timeMin: start.toISOString(),
          timeMax: end.toISOString(),
          timeZone: config.BUSINESS_TIMEZONE,
          items: [{ id: config.GOOGLE_CALENDAR_ID }]
        }
      });

      const busyPeriods = freebusy.data.calendars?.[config.GOOGLE_CALENDAR_ID]?.busy ?? [];
      const slots = generateSlots(date);
      const availableSlots = slots
        .filter((slotStart) => {
          return !busyPeriods.some((period) => {
            if (!period.start || !period.end) {
              return false;
            }
            return overlaps(slotStart, new Date(period.start), new Date(period.end));
          });
        })
        .map((slot) => `${String(slot.getHours()).padStart(2, "0")}:${String(slot.getMinutes()).padStart(2, "0")}`);

      if (availableSlots.length === 0) {
        return { date, availableSlots: [], message: "No availability on this date" };
      }

      return { date, availableSlots };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Failed to check availability" };
    }
  }
});
