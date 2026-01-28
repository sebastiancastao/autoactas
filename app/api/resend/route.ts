import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import type { ResendEmailPayload } from "@/lib/api/resend";

const sanitizeRecipients = (value?: string | string[]) => {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    const normalized = value
      .map((recipient) => recipient.trim())
      .filter((recipient) => recipient.length > 0);
    return normalized.length > 0 ? normalized : undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const formatError = (message: string, status = 400) =>
  NextResponse.json({ message }, { status });

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return formatError("RESEND_API_KEY is not configured.", 500);
  }

  let body: ResendEmailPayload;
  try {
    body = (await request.json()) as ResendEmailPayload;
  } catch {
    return formatError("Request body must be valid JSON.");
  }

  const { to, subject, html, text, from, cc, bcc, replyTo } = body ?? {};
  const recipients = sanitizeRecipients(to);
  if (!recipients) {
    return formatError(
      "The 'to' field is required and must be a non-empty email or list of emails."
    );
  }
  if (!subject?.trim()) {
    return formatError("The 'subject' field is required.");
  }
  if (!html?.trim()) {
    return formatError("The 'html' field is required.");
  }

  const senderCandidate = sanitizeRecipients(from ?? process.env.RESEND_DEFAULT_FROM);
  const sender = Array.isArray(senderCandidate) ? senderCandidate[0] : senderCandidate;
  if (!sender) {
    return formatError(
      "The 'from' field is required. Set RESEND_DEFAULT_FROM or include 'from' in the payload.",
      500
    );
  }

  try {
    const client = new Resend(apiKey);
    const ccRecipients = sanitizeRecipients(cc);
    const bccRecipients = sanitizeRecipients(bcc);

    await client.emails.send({
      to: recipients,
      subject: subject.trim(),
      html: html.trim(),
      ...(text ? { text: text.trim() } : {}),
      from: sender,
      ...(ccRecipients ? { cc: ccRecipients } : {}),
      ...(bccRecipients ? { bcc: bccRecipients } : {}),
      ...(replyTo ? { reply_to: replyTo.trim() } : {}),
    });

    return NextResponse.json({ message: "Email queued" }, { status: 202 });
  } catch (error) {
    console.error("Resend API error:", error);
    const message =
      error instanceof Error ? error.message : "Unexpected error while sending email.";
    return formatError(message, 500);
  }
}
