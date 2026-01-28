import { NextRequest, NextResponse } from "next/server";

const AUTHORIZATION_HEADER = "authorization";
const EVENT_REMINDER_SECRET_HEADER = "x-event-reminder-secret";
const AUTH_PREFIX = "Bearer ";

const respondWithSecretError = () =>
  NextResponse.json({ message: "CRON_SECRET is not configured." }, { status: 500 });

const respondUnauthorized = () => NextResponse.json({ message: "Unauthorized" }, { status: 401 });

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return respondWithSecretError();

  const authHeader = request.headers.get(AUTHORIZATION_HEADER);
  if (authHeader !== `${AUTH_PREFIX}${cronSecret}`) return respondUnauthorized();

  const reminderSecret = process.env.EVENT_REMINDER_SECRET?.trim();
  if (!reminderSecret) {
    return NextResponse.json(
      { message: "EVENT_REMINDER_SECRET is not configured." },
      { status: 500 }
    );
  }

  const eventReminderUrl = new URL("/api/event-reminders", request.url);

  const response = await fetch(eventReminderUrl, {
    method: "POST",
    headers: {
      [EVENT_REMINDER_SECRET_HEADER]: reminderSecret,
      "Content-Type": "application/json",
    },
  });

  const rawBody = await response.text();
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

  return NextResponse.json({ ok: true, payload: parsedBody });
}
