import { JWT } from "google-auth-library";

export type GoogleDriveUploadResult = {
  id: string;
  name: string;
  webViewLink?: string;
  webContentLink?: string;
};

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

export async function uploadDocxToGoogleDrive(params: {
  filename: string;
  buffer: Buffer;
  folderId?: string | null;
  shareWithEmails?: string[] | null;
}) {
  const clientEmail = getEnv("GOOGLE_DRIVE_CLIENT_EMAIL");
  const privateKey = parsePrivateKey(getEnv("GOOGLE_DRIVE_PRIVATE_KEY"));
  const folderId = params.folderId ?? process.env.GOOGLE_DRIVE_FOLDER_ID ?? null;
  const envShareWithEmail = process.env.GOOGLE_DRIVE_SHARE_WITH_EMAIL ?? null;
  const publicAccessMode = (process.env.GOOGLE_DRIVE_PUBLIC_ACCESS ?? "anyone_reader").trim().toLowerCase();

  const jwtClient = new JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  const auth = await jwtClient.authorize();
  const accessToken = auth?.access_token ?? jwtClient.credentials.access_token ?? null;
  if (!accessToken) throw new Error("Failed to obtain Google access token.");

  const mimeType =
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

  const metadata: Record<string, unknown> = {
    name: params.filename,
    mimeType,
  };
  if (folderId) metadata.parents = [folderId];

  const form = new FormData();
  form.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json; charset=UTF-8" })
  );
  const bytes = new Uint8Array(params.buffer);
  form.append("file", new Blob([bytes], { type: mimeType }), params.filename);

  const uploadUrl =
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink,webContentLink";
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Drive upload failed (${res.status}): ${text || res.statusText}`);
  }

  const uploaded = (await res.json()) as GoogleDriveUploadResult;

  const shareEmails = [
    ...(params.shareWithEmails ?? []),
    ...(envShareWithEmail ? [envShareWithEmail] : []),
  ]
    .map((e) => e.trim().toLowerCase())
    .filter(isValidEmail);
  const uniqueShareEmails = [...new Set(shareEmails)];

  if (uploaded.id && uniqueShareEmails.length > 0) {
    for (const shareWithEmail of uniqueShareEmails) {
      const permRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          uploaded.id
        )}/permissions?supportsAllDrives=true`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            type: "user",
            role: "writer",
            emailAddress: shareWithEmail,
          }),
        }
      );

      if (!permRes.ok) {
        const text = await permRes.text().catch(() => "");
        console.warn(
          `Google Drive permission grant failed (${permRes.status}) for ${shareWithEmail}: ${text || permRes.statusText}`
        );
      }
    }
  }

  if (uploaded.id && publicAccessMode !== "off") {
    const role = publicAccessMode === "anyone_writer" ? "writer" : "reader";
    const permRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(uploaded.id)}/permissions?supportsAllDrives=true`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "anyone",
          role,
          allowFileDiscovery: false,
        }),
      }
    );

    if (!permRes.ok) {
      const text = await permRes.text().catch(() => "");
      throw new Error(
        `Google Drive public sharing failed (${permRes.status}): ${text || permRes.statusText}`
      );
    }
  }

  return uploaded;
}
