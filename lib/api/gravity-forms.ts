export type GravityLeadRequest = {
  lead: Record<string, unknown>;
  inputValues?: Record<string, unknown>;
  fieldValues?: Record<string, unknown>;
};

type GravityLeadResponse = {
  message: string;
  mode?: "input_values" | "direct_input_values";
  status?: number;
  details?: unknown;
};

function extractErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const message = [record.message, record.error, record.detail, record.details].find(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  );
  return message ?? null;
}

export async function createGravityLead(
  payload: GravityLeadRequest,
): Promise<GravityLeadResponse> {
  const response = await fetch("/api/gravity-forms/lead", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const parsed = (await response.json().catch(() => null)) as GravityLeadResponse | null;
  if (!response.ok) {
    const message =
      extractErrorMessage(parsed) ??
      `Gravity Forms lead sync failed (${response.status} ${response.statusText}).`;
    throw new Error(message);
  }

  return (
    parsed ?? {
      message: "Lead synced.",
      status: response.status,
    }
  );
}
