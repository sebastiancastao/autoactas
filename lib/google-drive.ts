import { randomUUID } from "crypto";
import { JWT } from "google-auth-library";

import { getGoogleDriveOAuthAccessTokenByUsuarioId } from "./google-calendar-oauth";
import { createAdminSupabase } from "./supabase-admin";

export type GoogleDriveUploadResult = {
  id: string;
  name: string;
  webViewLink?: string;
  webContentLink?: string;
};

const DEFAULT_DOCUMENTS_BUCKET = "documentos";

let bucketReadyPromise: Promise<void> | null = null;

function isValidEmail(email: string | undefined | null): email is string {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return value;
}

function parsePrivateKey(raw: string) {
  return raw.replace(/\\n/g, "\n");
}

function getDocumentsBucketName() {
  const configured = process.env.SUPABASE_STORAGE_DOCUMENTS_BUCKET?.trim();
  return configured || DEFAULT_DOCUMENTS_BUCKET;
}

function sanitizeFileName(filename: string) {
  const raw = filename.trim() || "archivo";
  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_\.]+|[_\.]+$/g, "");
  return normalized || "archivo";
}

function buildStorageGroup(filename: string, mimeType: string) {
  const upperFileName = filename.trim().toUpperCase();
  const lowerMimeType = mimeType.trim().toLowerCase();

  if (upperFileName.includes("AUTO_ADMISION")) return "auto-admisorios";
  if (lowerMimeType.includes("sheet") || lowerMimeType.includes("excel")) return "excel";
  if (lowerMimeType === "application/pdf") return "pdf";
  if (lowerMimeType.includes("wordprocessingml")) return "actas";
  return "archivos";
}

function buildStoragePath(filename: string, mimeType: string) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  const safeName = sanitizeFileName(filename);
  const group = buildStorageGroup(filename, mimeType);
  return `${group}/${year}/${month}/${day}/${randomUUID()}-${safeName}`;
}

function isStoragePath(fileId: string) {
  return fileId.includes("/");
}

function withDownloadQuery(publicUrl: string, filename: string) {
  const url = new URL(publicUrl);
  url.searchParams.set("download", filename);
  return url.toString();
}

async function ensureDocumentsBucket() {
  if (!bucketReadyPromise) {
    bucketReadyPromise = (async () => {
      const supabase = createAdminSupabase();
      const bucketName = getDocumentsBucketName();

      const { data: existingBucket, error: getBucketError } = await supabase.storage.getBucket(
        bucketName
      );

      if (getBucketError) {
        const { error: createBucketError } = await supabase.storage.createBucket(bucketName, {
          public: true,
        });

        if (
          createBucketError &&
          !createBucketError.message.toLowerCase().includes("already exists")
        ) {
          throw new Error(
            `Supabase Storage bucket setup failed: ${createBucketError.message}`
          );
        }
        return;
      }

      if (!existingBucket.public) {
        const { error: updateBucketError } = await supabase.storage.updateBucket(bucketName, {
          public: true,
        });
        if (updateBucketError) {
          throw new Error(
            `Supabase Storage bucket update failed: ${updateBucketError.message}`
          );
        }
      }
    })().catch((error) => {
      bucketReadyPromise = null;
      throw error;
    });
  }

  await bucketReadyPromise;
}

async function resolveUsuarioIdByAuthId(authUserId: string | null | undefined) {
  const normalizedAuthUserId = authUserId?.trim() ?? "";
  if (!normalizedAuthUserId) return null;

  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from("usuarios")
    .select("id")
    .eq("auth_id", normalizedAuthUserId)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo resolver el usuario autenticado: ${error.message}`);
  }

  return data?.id ?? null;
}

async function getGoogleDriveOAuthAuthorization(params: {
  usuarioId?: string | null;
  fallbackAuthUserId?: string | null;
}) {
  const candidateUsuarioIds: string[] = [];

  const preferredUsuarioId = params.usuarioId?.trim();
  if (preferredUsuarioId) candidateUsuarioIds.push(preferredUsuarioId);

  const authUsuarioId = await resolveUsuarioIdByAuthId(params.fallbackAuthUserId ?? null);
  if (authUsuarioId && !candidateUsuarioIds.includes(authUsuarioId)) {
    candidateUsuarioIds.push(authUsuarioId);
  }

  for (const usuarioId of candidateUsuarioIds) {
    const authorization = await getGoogleDriveOAuthAccessTokenByUsuarioId(usuarioId);
    if (authorization) return authorization;
  }

  return null;
}

async function getGoogleDriveAccessToken() {
  const clientEmail = getEnv("GOOGLE_DRIVE_CLIENT_EMAIL");
  const privateKey = parsePrivateKey(getEnv("GOOGLE_DRIVE_PRIVATE_KEY"));

  const jwtClient = new JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });

  const auth = await jwtClient.authorize();
  const accessToken = auth?.access_token ?? jwtClient.credentials.access_token ?? null;
  if (!accessToken) throw new Error("Failed to obtain Google access token.");
  return accessToken;
}

async function downloadLegacyGoogleDriveFileBuffer(fileId: string) {
  const accessToken = await getGoogleDriveAccessToken();
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Google Drive file download failed (${response.status}): ${text || response.statusText}`
    );
  }

  const bytes = await response.arrayBuffer();
  return Buffer.from(bytes);
}

async function uploadBufferToStorage(params: {
  filename: string;
  buffer: Buffer;
  mimeType: string;
  folderId?: string | null;
  shareWithEmails?: string[] | null;
  convertToGoogleDocs?: boolean;
}) {
  await ensureDocumentsBucket();

  const supabase = createAdminSupabase();
  const bucketName = getDocumentsBucketName();
  const objectPath = buildStoragePath(params.filename, params.mimeType);

  const { error: uploadError } = await supabase.storage
    .from(bucketName)
    .upload(objectPath, params.buffer, {
      contentType: params.mimeType,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Supabase Storage upload failed: ${uploadError.message}`);
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(bucketName).getPublicUrl(objectPath);

  return {
    id: objectPath,
    name: params.filename,
    webViewLink: publicUrl,
    webContentLink: withDownloadQuery(publicUrl, sanitizeFileName(params.filename)),
  } satisfies GoogleDriveUploadResult;
}

async function uploadBufferToGoogleOAuthDrive(params: {
  filename: string;
  buffer: Buffer;
  mimeType: string;
  usuarioId?: string | null;
  fallbackAuthUserId?: string | null;
  convertToGoogleDocs?: boolean;
}) {
  const authorization = await getGoogleDriveOAuthAuthorization({
    usuarioId: params.usuarioId,
    fallbackAuthUserId: params.fallbackAuthUserId,
  });

  if (!authorization) return null;

  const metadata: Record<string, unknown> = {
    name: params.filename,
    mimeType: params.convertToGoogleDocs
      ? "application/vnd.google-apps.document"
      : params.mimeType,
  };

  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json; charset=UTF-8" }),
  );
  form.append(
    "file",
    new Blob([new Uint8Array(params.buffer)], { type: params.mimeType }),
    params.filename,
  );

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authorization.accessToken}`,
      },
      body: form,
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Google Drive OAuth upload failed (${res.status}): ${text || res.statusText}`,
    );
  }

  return (await res.json()) as GoogleDriveUploadResult;
}

export async function uploadDocxToGoogleDrive(params: {
  filename: string;
  buffer: Buffer;
  folderId?: string | null;
  shareWithEmails?: string[] | null;
  convertToGoogleDocs?: boolean;
  usuarioId?: string | null;
  fallbackAuthUserId?: string | null;
}) {
  const oauthUpload = await uploadBufferToGoogleOAuthDrive({
    filename: params.filename,
    buffer: params.buffer,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    usuarioId: params.usuarioId ?? null,
    fallbackAuthUserId: params.fallbackAuthUserId ?? null,
    convertToGoogleDocs: params.convertToGoogleDocs ?? true,
  });
  if (oauthUpload) return oauthUpload;

  return uploadBufferToStorage({
    ...params,
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

export async function downloadStoredFileBuffer(fileId: string): Promise<Buffer> {
  const normalizedFileId = fileId.trim();
  if (!normalizedFileId) {
    throw new Error("Missing file identifier.");
  }

  if (!isStoragePath(normalizedFileId)) {
    return downloadLegacyGoogleDriveFileBuffer(normalizedFileId);
  }

  await ensureDocumentsBucket();
  const supabase = createAdminSupabase();
  const bucketName = getDocumentsBucketName();

  const { data, error } = await supabase.storage.from(bucketName).download(normalizedFileId);
  if (error || !data) {
    throw new Error(
      `Supabase Storage download failed: ${error?.message ?? "file not found"}`
    );
  }

  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function exportFileAsPdf(fileId: string): Promise<Buffer> {
  const normalizedFileId = fileId.trim();
  if (!normalizedFileId) throw new Error("Missing file identifier.");

  if (isStoragePath(normalizedFileId)) {
    if (!normalizedFileId.toLowerCase().endsWith(".pdf")) {
      throw new Error(
        "Supabase Storage no convierte DOCX a PDF automaticamente. Se enviara el enlace del documento."
      );
    }
    return downloadStoredFileBuffer(normalizedFileId);
  }

  const clientEmail = getEnv("GOOGLE_DRIVE_CLIENT_EMAIL");
  const privateKey = parsePrivateKey(getEnv("GOOGLE_DRIVE_PRIVATE_KEY"));

  const jwtClient = new JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });

  const auth = await jwtClient.authorize();
  const accessToken = auth?.access_token ?? jwtClient.credentials.access_token ?? null;
  if (!accessToken) throw new Error("Failed to obtain Google access token.");

  const exportUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
    normalizedFileId
  )}/export?mimeType=application/pdf`;
  const res = await fetch(exportUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Drive PDF export failed (${res.status}): ${text || res.statusText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function uploadFileToGoogleDrive(params: {
  filename: string;
  buffer: Buffer;
  mimeType: string;
  folderId?: string | null;
  shareWithEmails?: string[] | null;
}) {
  if (!params.mimeType?.trim()) {
    throw new Error("Missing mimeType for file upload.");
  }

  const uniqueShareEmails = [...new Set((params.shareWithEmails ?? []).filter(isValidEmail))];
  void uniqueShareEmails;

  return uploadBufferToStorage(params);
}
