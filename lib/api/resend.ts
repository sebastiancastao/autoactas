export type ResendEmailPayload = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
};

export type ResendApiResponse = {
  id: string;
  message: string;
};

const toJson = async (response: Response) => {
  const payload = await response.text();
  try {
    return JSON.parse(payload);
  } catch {
    return payload;
  }
};

export async function sendResendEmail(payload: ResendEmailPayload): Promise<ResendApiResponse> {
  const response = await fetch("/api/resend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await toJson(response);
    throw new Error(
      `Resend proxy failed (${response.status} ${response.statusText}): ${
        typeof body === "string" ? body : JSON.stringify(body)
      }`
    );
  }

  return response.json();
}
