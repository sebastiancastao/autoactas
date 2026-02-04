import { NextRequest, NextResponse } from "next/server";

const AUTHORIZATION_HEADER = "authorization";
const EVENT_REMINDER_SECRET_HEADER = "x-event-reminder-secret";
const AUTH_PREFIX = "Bearer ";
const DEBUG_SNIPPET_LENGTH = 200;

const respondWithSecretError = () =>
  NextResponse.json({ message: "CRON_SECRET is not configured." }, { status: 500 });

const respondUnauthorized = () => NextResponse.json({ message: "Unauthorized" }, { status: 401 });

const truncateSnippet = (value: string | null) => {
  if (!value) return value;
  return value.length > DEBUG_SNIPPET_LENGTH ? `${value.slice(0, DEBUG_SNIPPET_LENGTH)}…` : value;
};

const logCronDebug = (message: string, context: Record<string, unknown> = {}) =>
  console.log(`[api/cron] ${message}`, context);

export async function GET(request: NextRequest) {
  const invocationTime = new Date();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get(AUTHORIZATION_HEADER);

  logCronDebug("cron invocation received", {
    invocationTime: invocationTime.toISOString(),
    cronSecretConfigured: Boolean(cronSecret),
    requestUrl: request.url,
    hasAuthorizationHeader: Boolean(authHeader),
  });

  if (!cronSecret) return respondWithSecretError();

  const expectedHeader = `${AUTH_PREFIX}${cronSecret}`;
  const isAuthorized = authHeader === expectedHeader;
  logCronDebug("authorization check", { isAuthorized });
  if (!isAuthorized) return respondUnauthorized();

  const reminderSecret = process.env.EVENT_REMINDER_SECRET?.trim();
  logCronDebug("event reminder secret configured", { reminderSecretConfigured: Boolean(reminderSecret) });
  if (!reminderSecret) {
    return NextResponse.json(
      { message: "EVENT_REMINDER_SECRET is not configured." },
      { status: 500 }
    );
  }

  const eventReminderUrl = new URL("/api/event-reminders", request.url);

  const fetchStart = Date.now();
  const response = await fetch(eventReminderUrl, {
    method: "POST",
    headers: {
      [EVENT_REMINDER_SECRET_HEADER]: reminderSecret,
      "Content-Type": "application/json",
    },
  });

  const rawBody = await response.text();
  const fetchDurationMs = Date.now() - fetchStart;
  const snippet = truncateSnippet(rawBody);
  logCronDebug("event reminder response", {
    status: response.status,
    statusText: response.statusText,
    durationMs: fetchDurationMs,
    responseSnippet: snippet,
  });

  if (!response.ok) {
    return NextResponse.json(
      {
        ok: false,
        message: "Event reminder execution failed.",
        status: response.status,
        response: rawBody,
      },
      { status: 502 }
    );
  }

  let parsedBody: unknown = null;
  try {
    parsedBody = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    parsedBody = rawBody;
  }

  return NextResponse.json({
    ok: true,
    payload: parsedBody,
    debug: {
      triggeredAt: invocationTime.toISOString(),
      eventReminderStatus: response.status,
      eventReminderDurationMs: fetchDurationMs,
    },
  });
}
