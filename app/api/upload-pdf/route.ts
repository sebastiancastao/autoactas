import { NextResponse } from "next/server";

import { uploadFileToGoogleDrive } from "@/lib/google-drive";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!file || typeof file === "string") {
      return NextResponse.json(
        { error: "Falta el archivo (field: file)." },
        { status: 400 }
      );
    }

    const filename = (file as File).name || "archivo.pdf";
    const mimeType = (file as File).type || "application/pdf";

    if (!filename.toLowerCase().endsWith(".pdf") && mimeType !== "application/pdf") {
      return NextResponse.json(
        { error: "Solo se permite subir archivos PDF." },
        { status: 400 }
      );
    }

    const arrayBuffer = await (file as File).arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const uploaded = await uploadFileToGoogleDrive({
      filename,
      buffer,
      mimeType: "application/pdf",
    });

    return NextResponse.json({
      fileId: uploaded.id,
      fileName: uploaded.name,
      webViewLink: uploaded.webViewLink ?? null,
      webContentLink: uploaded.webContentLink ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { error: "No se pudo subir el PDF.", detail: msg },
      { status: 500 }
    );
  }
}

