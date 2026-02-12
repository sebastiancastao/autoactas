import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { uploadFileToGoogleDrive } from "@/lib/google-drive";
import type { Database } from "@/lib/database.types";

export const runtime = "nodejs";

const EXCEL_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

type StoredExcelRow = {
  id: string;
  proceso_id: string;
  drive_file_id: string;
  drive_file_name: string;
  drive_web_view_link: string | null;
  drive_web_content_link: string | null;
  created_at: string;
};

function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !serviceKey) return null;

  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, detectSessionInUrl: false },
  });
}

function buildTargetFileName(originalName: string, procesoNumero: string | null) {
  const baseName = originalName.trim() || "archivo.xlsx";
  const extensionMatch = baseName.match(/\.(xlsx|xls)$/i);
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : "xlsx";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (!procesoNumero) return `excel_${stamp}.${extension}`;
  const safeProcesoNumero = procesoNumero.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `proceso_${safeProcesoNumero}_${stamp}.${extension}`;
}

function normalizeProcesoIds(raw: string | null) {
  if (!raw) return [] as string[];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export async function GET(req: Request) {
  try {
    const supabase = createSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(req.url);
    const procesoIds = normalizeProcesoIds(searchParams.get("procesoIds"));
    if (procesoIds.length === 0) {
      return NextResponse.json({ files: [] as StoredExcelRow[] });
    }

    const { data, error } = await supabase
      .from("proceso_excel_archivos")
      .select(
        "id, proceso_id, drive_file_id, drive_file_name, drive_web_view_link, drive_web_content_link, created_at"
      )
      .in("proceso_id", procesoIds)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: "Unable to load Excel files.", detail: error.message },
        { status: 500 }
      );
    }

    const latestByProcesoId: Record<string, StoredExcelRow> = {};
    for (const row of (data ?? []) as StoredExcelRow[]) {
      if (!latestByProcesoId[row.proceso_id]) {
        latestByProcesoId[row.proceso_id] = row;
      }
    }

    return NextResponse.json({ files: Object.values(latestByProcesoId) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Unable to load Excel files.", detail: message },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const supabase = createSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 500 }
      );
    }

    const form = await req.formData();
    const file = form.get("file");
    const procesoIdRaw = form.get("procesoId");
    const procesoId =
      typeof procesoIdRaw === "string" && procesoIdRaw.trim()
        ? procesoIdRaw.trim()
        : null;
    const authUserIdRaw = form.get("authUserId");
    const authUserId =
      typeof authUserIdRaw === "string" && authUserIdRaw.trim()
        ? authUserIdRaw.trim()
        : null;
    const procesoNumeroRaw = form.get("procesoNumero");
    const procesoNumero =
      typeof procesoNumeroRaw === "string" && procesoNumeroRaw.trim()
        ? procesoNumeroRaw.trim()
        : null;

    if (!procesoId) {
      return NextResponse.json(
        { error: "Missing procesoId (field: procesoId)." },
        { status: 400 }
      );
    }

    if (!file || typeof file === "string") {
      return NextResponse.json(
        { error: "Missing file (field: file)." },
        { status: 400 }
      );
    }

    const excelFile = file as File;
    const inputName = excelFile.name || "archivo.xlsx";
    const lowerName = inputName.toLowerCase();
    const hasValidExtension = lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls");
    const hasValidMimeType = EXCEL_MIME_TYPES.has(excelFile.type);

    if (!hasValidExtension && !hasValidMimeType) {
      return NextResponse.json(
        { error: "Only Excel files are allowed (.xlsx, .xls)." },
        { status: 400 }
      );
    }

    const arrayBuffer = await excelFile.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileName = buildTargetFileName(inputName, procesoNumero);
    const mimeType = hasValidMimeType
      ? excelFile.type
      : lowerName.endsWith(".xls")
      ? "application/vnd.ms-excel"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    const uploaded = await uploadFileToGoogleDrive({
      filename: fileName,
      buffer,
      mimeType,
    });

    const { data: stored, error: storeError } = await supabase
      .from("proceso_excel_archivos")
      .insert({
        proceso_id: procesoId,
        original_file_name: inputName,
        drive_file_id: uploaded.id,
        drive_file_name: uploaded.name,
        drive_web_view_link: uploaded.webViewLink ?? null,
        drive_web_content_link: uploaded.webContentLink ?? null,
        mime_type: mimeType,
        uploaded_by_auth_id: authUserId,
      })
      .select(
        "id, proceso_id, drive_file_id, drive_file_name, drive_web_view_link, drive_web_content_link, created_at"
      )
      .single();

    if (storeError || !stored) {
      return NextResponse.json(
        {
          error: "Excel uploaded to Drive, but failed to save metadata in database.",
          detail: storeError?.message ?? "Unknown database error.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      id: stored.id,
      procesoId: stored.proceso_id,
      fileId: stored.drive_file_id,
      fileName: stored.drive_file_name,
      webViewLink: stored.drive_web_view_link ?? null,
      webContentLink: stored.drive_web_content_link ?? null,
      createdAt: stored.created_at,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Unable to upload Excel file.", detail: message },
      { status: 500 }
    );
  }
}
