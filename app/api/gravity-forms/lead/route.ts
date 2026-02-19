import { NextRequest, NextResponse } from "next/server";

type JsonRecord = Record<string, unknown>;
type DeliveryResult = {
  ok: boolean;
  status: number;
  statusText: string;
  body: unknown;
};

const DEFAULT_TIMEOUT_MS = 12_000;
const RESPONSE_PREVIEW_MAX_LENGTH = 600;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeScalar(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => normalizeScalar(item)).filter(Boolean).join(", ");
  }
  if (isRecord(value)) {
    return JSON.stringify(value);
  }
  return String(value);
}

function toNormalizedRecord(source: JsonRecord): Record<string, string> {
  const out: Record<string, string> = {};
  Object.entries(source).forEach(([key, value]) => {
    const trimmedKey = key.trim();
    if (!trimmedKey) return;
    out[trimmedKey] = normalizeScalar(value);
  });
  return out;
}

function parseJsonEnvObject(envName: string, rawValue: string | undefined): JsonRecord | null {
  if (!rawValue?.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new Error(`${envName} must be a valid JSON object.`);
  }
  if (!isRecord(parsed)) {
    throw new Error(`${envName} must be a JSON object.`);
  }
  return parsed;
}

function resolvePath(source: JsonRecord, path: string): unknown {
  const segments = path
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);

  let cursor: unknown = source;
  for (const segment of segments) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

function buildInputValuesFromLead(
  lead: JsonRecord,
  configuredFieldMap: JsonRecord | null,
  configuredStaticValues: JsonRecord | null,
): Record<string, string> {
  const inputValues: Record<string, string> = {};

  if (configuredFieldMap) {
    Object.entries(configuredFieldMap).forEach(([inputKey, sourcePathValue]) => {
      const sourcePath = toTrimmedString(sourcePathValue);
      if (!sourcePath) return;
      inputValues[inputKey] = normalizeScalar(resolvePath(lead, sourcePath));
    });
  } else {
    const fallbackFieldMap: Record<string, string> = {
      numero_proceso: "numeroProceso",
      proceso_id: "procesoId",
      tipo_proceso: "tipoProceso",
      juzgado: "juzgado",
      descripcion: "descripcion",
      estado: "estado",
      deudor_nombre: "deudor.nombre",
      deudor_identificacion: "deudor.identificacion",
      deudor_email: "deudor.email",
      deudor_telefono: "deudor.telefono",
      acreedor_nombre: "acreedorPrincipal.nombre",
      acreedor_identificacion: "acreedorPrincipal.identificacion",
      acreedor_email: "acreedorPrincipal.email",
      acreedor_telefono: "acreedorPrincipal.telefono",
      acreedores_count: "acreedoresCount",
      created_by_email: "createdByEmail",
      created_by_auth_id: "createdByAuthId",
      created_at: "createdAt",
    };

    Object.entries(fallbackFieldMap).forEach(([field, path]) => {
      inputValues[field] = normalizeScalar(resolvePath(lead, path));
    });
  }

  if (configuredStaticValues) {
    Object.entries(toNormalizedRecord(configuredStaticValues)).forEach(([key, value]) => {
      inputValues[key] = value;
    });
  }

  return inputValues;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    if (raw.length <= RESPONSE_PREVIEW_MAX_LENGTH) return raw;
    return `${raw.slice(0, RESPONSE_PREVIEW_MAX_LENGTH)}...`;
  }
}

async function deliver(
  url: string,
  headers: Record<string, string>,
  payload: unknown,
  timeoutMs: number,
): Promise<DeliveryResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await parseResponseBody(response);
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      body,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function createBasicAuthHeader(user: string | null, password: string | null): string | null {
  if (!user || !password) return null;
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const endpoint = process.env.GRAVITY_FORMS_SUBMISSIONS_URL?.trim();
  if (!endpoint) {
    return NextResponse.json(
      { message: "GRAVITY_FORMS_SUBMISSIONS_URL is not configured." },
      { status: 500 },
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json({ message: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!isRecord(parsedBody)) {
    return NextResponse.json({ message: "Request body must be an object." }, { status: 400 });
  }

  const lead = isRecord(parsedBody.lead) ? parsedBody.lead : parsedBody;
  const requestInputValues = isRecord(parsedBody.inputValues) ? parsedBody.inputValues : null;
  const requestFieldValues = isRecord(parsedBody.fieldValues) ? parsedBody.fieldValues : null;

  let configuredFieldMap: JsonRecord | null = null;
  let configuredStaticValues: JsonRecord | null = null;
  try {
    configuredFieldMap = parseJsonEnvObject("GRAVITY_FORMS_FIELD_MAP", process.env.GRAVITY_FORMS_FIELD_MAP);
    configuredStaticValues = parseJsonEnvObject(
      "GRAVITY_FORMS_STATIC_VALUES",
      process.env.GRAVITY_FORMS_STATIC_VALUES,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid Gravity Forms env configuration.";
    return NextResponse.json({ message }, { status: 500 });
  }

  const inputValues = requestInputValues
    ? toNormalizedRecord(requestInputValues)
    : buildInputValuesFromLead(lead, configuredFieldMap, configuredStaticValues);

  if (Object.keys(inputValues).length === 0) {
    return NextResponse.json(
      {
        message:
          "No input values were produced for Gravity Forms. Provide inputValues in the request or configure GRAVITY_FORMS_FIELD_MAP.",
      },
      { status: 400 },
    );
  }

  const fieldValues = requestFieldValues ? toNormalizedRecord(requestFieldValues) : undefined;
  const timeoutMs = Number.parseInt(process.env.GRAVITY_FORMS_TIMEOUT_MS ?? "", 10);
  const resolvedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const authHeader = createBasicAuthHeader(
    process.env.GRAVITY_FORMS_BASIC_AUTH_USER?.trim() ?? null,
    process.env.GRAVITY_FORMS_BASIC_AUTH_PASSWORD?.trim() ?? null,
  );

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (authHeader) {
    headers.Authorization = authHeader;
  }

  const preferredPayload = {
    input_values: inputValues,
    ...(fieldValues && Object.keys(fieldValues).length > 0 ? { field_values: fieldValues } : {}),
  };
  const preferredResult = await deliver(endpoint, headers, preferredPayload, resolvedTimeoutMs);
  if (preferredResult.ok) {
    return NextResponse.json(
      {
        message: "Lead sent to Gravity Forms.",
        mode: "input_values",
        status: preferredResult.status,
        details: preferredResult.body,
      },
      { status: 202 },
    );
  }

  const directResult = await deliver(endpoint, headers, inputValues, resolvedTimeoutMs);
  if (directResult.ok) {
    return NextResponse.json(
      {
        message: "Lead sent to Gravity Forms.",
        mode: "direct_input_values",
        status: directResult.status,
        details: directResult.body,
      },
      { status: 202 },
    );
  }

  return NextResponse.json(
    {
      message: "Gravity Forms rejected the lead payload.",
      endpoint,
      attempts: [
        {
          mode: "input_values",
          status: preferredResult.status,
          statusText: preferredResult.statusText,
          details: preferredResult.body,
        },
        {
          mode: "direct_input_values",
          status: directResult.status,
          statusText: directResult.statusText,
          details: directResult.body,
        },
      ],
    },
    { status: 502 },
  );
}
