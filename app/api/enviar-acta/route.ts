import { NextResponse } from "next/server";
import { Resend } from "resend";
import { exportFileAsPdf } from "@/lib/google-drive";

export const runtime = "nodejs";

type EnviarActaPayload = {
  apoderadoEmails: string[];
  numeroProceso: string;
  titulo: string;
  fecha: string;
  webViewLink: string;
  fileId?: string;
  fileName?: string;
};

function toErrorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") return JSON.stringify(e, Object.getOwnPropertyNames(e));
  return String(e);
}

function isValidEmail(email: string | undefined | null): email is string {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

async function sendApoderadoEmails(params: {
  apoderadoEmails: string[];
  numeroProceso: string;
  titulo: string;
  fecha: string;
  webViewLink: string;
  fileId?: string;
  fileName?: string;
}) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.warn("RESEND_API_KEY not configured, skipping email notifications");
    return { sent: 0, errors: ["RESEND_API_KEY not configured"] };
  }

  const sender = process.env.RESEND_DEFAULT_FROM?.trim();
  if (!sender) {
    console.warn("RESEND_DEFAULT_FROM not configured, skipping email notifications");
    return { sent: 0, errors: ["RESEND_DEFAULT_FROM not configured"] };
  }

  const resend = new Resend(apiKey);
  const errors: string[] = [];
  let sent = 0;

  // Export the Google Drive file as PDF if fileId is provided
  let pdfBuffer: Buffer | null = null;
  let pdfFilename = "documento.pdf";
  if (params.fileId) {
    try {
      pdfBuffer = await exportFileAsPdf(params.fileId);
      pdfFilename = (params.fileName ?? "documento").replace(/\.docx$/i, "") + ".pdf";
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Failed to export PDF from Google Drive:", msg);
      errors.push(`PDF export: ${msg}`);
    }
  }

  const subject = `Acta de Audiencia - ${params.numeroProceso} - ${params.fecha}`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #18181b; margin-bottom: 16px;">Acta de Audiencia Disponible</h2>
      <p style="color: #3f3f46; line-height: 1.6;">
        Se ha generado el acta de la audiencia del proceso <strong>${params.numeroProceso}</strong>.
      </p>
      <p style="color: #3f3f46; line-height: 1.6;">
        <strong>Titulo:</strong> ${params.titulo}<br/>
        <strong>Fecha:</strong> ${params.fecha}
      </p>
      ${pdfBuffer ? `<p style="color: #3f3f46; line-height: 1.6;">El documento se encuentra adjunto en formato PDF.</p>` : `
      <p style="margin: 24px 0;">
        <a href="${params.webViewLink}"
           style="display: inline-block; background-color: #18181b; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 500;">
          Ver documento en Google Drive
        </a>
      </p>`}
      <p style="color: #71717a; font-size: 14px; margin-top: 32px;">
        Este correo fue enviado automaticamente por AutoActas.
      </p>
    </div>
  `;

  for (const email of params.apoderadoEmails) {
    try {
      await resend.emails.send({
        from: sender,
        to: email,
        subject,
        html,
        ...(pdfBuffer
          ? {
              attachments: [
                {
                  filename: pdfFilename,
                  content: pdfBuffer,
                },
              ],
            }
          : {}),
      });
      sent++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Failed to send email to ${email}:`, msg);
      errors.push(`${email}: ${msg}`);
    }
  }

  return { sent, errors };
}

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as EnviarActaPayload;

    if (!payload?.apoderadoEmails || payload.apoderadoEmails.length === 0) {
      return NextResponse.json({ error: "No hay correos de apoderados para enviar." }, { status: 400 });
    }
    if (!payload?.webViewLink) {
      return NextResponse.json({ error: "Missing webViewLink." }, { status: 400 });
    }
    if (!payload?.numeroProceso) {
      return NextResponse.json({ error: "Missing numeroProceso." }, { status: 400 });
    }

    // Filter valid emails
    const validEmails = payload.apoderadoEmails.filter(isValidEmail);

    if (validEmails.length === 0) {
      return NextResponse.json({ error: "No hay correos validos de apoderados." }, { status: 400 });
    }

    const emailResult = await sendApoderadoEmails({
      apoderadoEmails: validEmails,
      numeroProceso: payload.numeroProceso,
      titulo: payload.titulo || "Audiencia",
      fecha: payload.fecha || new Date().toLocaleDateString("es-CO"),
      webViewLink: payload.webViewLink,
      fileId: payload.fileId,
      fileName: payload.fileName,
    });

    return NextResponse.json({
      emailsSent: emailResult.sent,
      emailErrors: emailResult.errors.length > 0 ? emailResult.errors : undefined,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "Failed to send emails.", detail: toErrorMessage(e) },
      { status: 500 }
    );
  }
}
