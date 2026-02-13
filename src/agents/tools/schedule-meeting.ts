import { tool } from "@openai/agents";
import { google } from "googleapis";
import { z } from "zod";

import { config } from "../../config/env.js";

const authClient =
  config.ENABLE_CALENDAR_TOOLS && config.GOOGLE_CLIENT_EMAIL && config.GOOGLE_PRIVATE_KEY
    ? new google.auth.JWT({
        email: config.GOOGLE_CLIENT_EMAIL,
        key: config.GOOGLE_PRIVATE_KEY,
        scopes: ["https://www.googleapis.com/auth/calendar"]
      })
    : null;

const calendar = authClient ? google.calendar({ version: "v3", auth: authClient }) : null;

function parseStartDate(date: string, time: string): Date {
  return new Date(`${date}T${time}:00`);
}

function isWithinBusinessHours(date: Date): boolean {
  const day = date.getDay();
  const hours = date.getHours();
  const isWorkingDay = day >= 1 && day <= 6;
  return isWorkingDay && hours >= config.WORKDAY_START_HOUR && hours < config.WORKDAY_END_HOUR;
}

export const scheduleMeetingTool = tool({
  name: "schedule_meeting",
  description:
    "Schedule a meeting or appointment on the calendar. Use this when the caller wants to book a new appointment.",
  parameters: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    time: z.string().regex(/^\d{2}:\d{2}$/),
    name: z.string().min(1),
    phone: z.string().optional()
  }),
  async execute({ date, time, name, phone }) {
    if (!config.ENABLE_CALENDAR_TOOLS || !calendar || !config.GOOGLE_CALENDAR_ID) {
      return { error: "Calendar tool is not enabled" };
    }

    try {
      const startDate = parseStartDate(date, time);
      if (Number.isNaN(startDate.getTime())) {
        return { error: "Invalid date/time format" };
      }

      if (!isWithinBusinessHours(startDate)) {
        return { error: "Requested time is outside business hours" };
      }

      const endDate = new Date(startDate.getTime() + 30 * 60 * 1000);

      const event = await calendar.events.insert({
        calendarId: config.GOOGLE_CALENDAR_ID,
        requestBody: {
          summary: `Appointment - ${name}`,
          description: phone ? `Caller phone: ${phone}` : undefined,
          start: {
            dateTime: startDate.toISOString(),
            timeZone: config.BUSINESS_TIMEZONE
          },
          end: {
            dateTime: endDate.toISOString(),
            timeZone: config.BUSINESS_TIMEZONE
          }
        }
      });

      return {
        status: "confirmed",
        eventId: event.data.id,
        startTime: startDate.toISOString(),
        endTime: endDate.toISOString()
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Failed to schedule meeting" };
    }
  }
});
