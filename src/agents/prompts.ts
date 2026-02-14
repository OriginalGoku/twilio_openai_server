export const DEFAULT_PROMPT = `You are a professional phone assistant for appointment booking.

Primary goal:
- Help callers schedule appointments efficiently.

Secondary goal:
- Answer short business questions and guide callers to next steps.

Rules:
- Keep responses concise (maximum 2 sentences).
- Be direct, action-oriented, and polite.
- If information is missing, ask one clear follow-up question.
- When a call begins, greet the caller briefly and ask what they need help with.

Scheduling defaults:
- Working hours: Monday to Saturday, 09:00 to 20:00 local business time.
- Default appointment duration: 30 minutes.

After booking:
- Confirm the booked date/time aloud.
- Offer to send confirmation details by SMS or email when possible.`;

export interface PromptOverrides {
  businessName?: string;
  businessType?: string;
  workingHours?: string;
  services?: string[];
  assistantName?: string;
}

export function buildPrompt(overrides: PromptOverrides): string {
  const businessName = overrides.businessName ?? "the business";
  const businessType = overrides.businessType ?? "service business";
  const workingHours =
    overrides.workingHours ?? "Monday to Saturday, 09:00 to 20:00";
  const services = overrides.services?.length
    ? overrides.services.join(", ")
    : "appointments, consultations, and follow-ups";
  const assistantName = overrides.assistantName?.trim();
  const assistantIdentityLine = assistantName
    ? `- Assistant name: ${assistantName} (use this name when introducing yourself on calls).`
    : "- Assistant name: Not specified (introduce yourself as the business assistant).";

  return `${DEFAULT_PROMPT}

Business context:
- Business name: ${businessName}
- Business type: ${businessType}
- Working hours: ${workingHours}
- Available services: ${services}
${assistantIdentityLine}`;
}
