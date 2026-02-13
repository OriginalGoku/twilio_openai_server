import type { FastifyReply, FastifyRequest } from "fastify";

import { logger } from "../utils/logger.js";

interface StatusCallbackBody {
  AccountSid?: string;
  ApiVersion?: string;
  CallbackSource?: string;
  CallSid?: string;
  ParentCallSid?: string;
  CallStatus?: string;
  Direction?: string;
  From?: string;
  To?: string;
  Caller?: string;
  Called?: string;
  Timestamp?: string;
  SequenceNumber?: string;
  AnsweredBy?: string;
  SipResponseCode?: string;
  ErrorCode?: string;
  ErrorMessage?: string;
  CallDuration?: string;
  RecordingUrl?: string;
  RecordingSid?: string;
}

export async function callStatusCallbackHandler(
  request: FastifyRequest<{ Body: StatusCallbackBody }>,
  reply: FastifyReply,
): Promise<void> {
  const payload = request.body ?? {};
  const {
    CallSid,
    CallStatus,
    CallDuration,
    RecordingSid,
    RecordingUrl,
    ErrorCode,
    ErrorMessage,
    Timestamp,
    SequenceNumber,
    AnsweredBy,
    SipResponseCode,
    CallbackSource,
    AccountSid,
    ApiVersion,
    Direction,
    From,
    To,
  } = payload;

  logger.info(
    {
      accountSid: AccountSid,
      apiVersion: ApiVersion,
      callbackSource: CallbackSource,
      callSid: CallSid,
      direction: Direction,
      from: From,
      to: To,
      status: CallStatus,
      sequenceNumber: SequenceNumber,
      timestamp: Timestamp,
      answeredBy: AnsweredBy,
      sipResponseCode: SipResponseCode,
      callDuration: CallDuration,
      errorCode: ErrorCode,
      errorMessage: ErrorMessage,
      recordingSid: RecordingSid,
      recordingUrl: RecordingUrl,
      rawPayload: payload,
    },
    "Received Twilio call status callback",
  );

  if (CallStatus === "completed") {
    logger.info(
      { callSid: CallSid, callDuration: CallDuration },
      "Call completed",
    );
  }

  if (
    CallStatus &&
    ["busy", "no-answer", "failed", "canceled"].includes(CallStatus)
  ) {
    logger.warn(
      {
        callSid: CallSid,
        status: CallStatus,
        errorCode: ErrorCode,
        errorMessage: ErrorMessage,
        sipResponseCode: SipResponseCode,
        answeredBy: AnsweredBy,
      },
      "Call ended with non-success status",
    );
  }

  if (ErrorCode || ErrorMessage) {
    logger.error(
      {
        callSid: CallSid,
        status: CallStatus,
        errorCode: ErrorCode,
        errorMessage: ErrorMessage,
        sipResponseCode: SipResponseCode,
      },
      "Twilio callback reported an error",
    );
  }

  reply.status(200).send();
}
