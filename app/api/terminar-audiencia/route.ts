import { NextResponse } from "next/server";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";

import { uploadDocxToGoogleDrive } from "@/lib/google-drive";

export const runtime = "nodejs";

type TerminarAudienciaPayload = {
  procesoId: string;
  numeroProceso?: string | null;
  titulo: string;
  fecha: string; // YYYY-MM-DD
  resumen: { total: number; presentes: number; ausentes: number };
  asistentes: Array<{
    nombre: string;
    email?: string;
    categoria: string;
    estado: string;
    tarjetaProfesional?: string;
    calidadApoderadoDe?: string;
  }>;
  acreencias: Array<{
    acreedor?: string | null;
    apoderado?: string | null;
    naturaleza?: string | null;
    prelacion?: string | null;
    capital?: number | null;
    int_cte?: number | null;
    int_mora?: number | null;
    otros?: number | null;
    total?: number | null;
    porcentaje?: number | null;
  }>;
};

function toErrorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") return JSON.stringify(e, Object.getOwnPropertyNames(e));
  return String(e);
}

function formatDateLong(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatNumber(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("es-CO", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function createDataTable(headers: string[], rows: string[][]) {
  const headerRow = new TableRow({
    children: headers.map(
      (header) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: header, bold: true })] })],
        })
    ),
  });

  const bodyRows = rows.map(
    (row) =>
      new TableRow({
        children: row.map(
          (cell) =>
            new TableCell({
              children: [new Paragraph(cell || "—")],
            })
        ),
      })
  );

  return new Table({
    rows: [headerRow, ...bodyRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

async function buildDocx(payload: TerminarAudienciaPayload) {
  const title = payload.titulo?.trim() || "Audiencia";
  const procesoLabel = payload.numeroProceso?.trim() || payload.procesoId;

  const asistentesRows = payload.asistentes.map((a) => [
    a.nombre || "—",
    a.categoria || "—",
    a.estado || "—",
    a.email?.trim() || "—",
    a.tarjetaProfesional?.trim() || "—",
    a.calidadApoderadoDe?.trim() || "—",
  ]);

  const acreenciasRows = payload.acreencias.map((a) => [
    a.acreedor?.trim() || "—",
    a.apoderado?.trim() || "—",
    a.naturaleza?.trim() || "—",
    a.prelacion?.trim() || "—",
    formatNumber(a.capital ?? null),
    formatNumber(a.int_cte ?? null),
    formatNumber(a.int_mora ?? null),
    formatNumber(a.otros ?? null),
    formatNumber(a.total ?? null),
    formatNumber(a.porcentaje ?? null),
  ]);

  const sections: Array<Paragraph | Table> = [
    new Paragraph({
      text: title,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Proceso: ", bold: true }),
        new TextRun(procesoLabel),
      ],
      spacing: { after: 80 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: "Fecha: ", bold: true }),
        new TextRun(formatDateLong(payload.fecha)),
      ],
      spacing: { after: 160 },
    }),
    new Paragraph({
      text: "Resumen de asistencia",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 160, after: 120 },
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: `Total: ${payload.resumen.total} · Presentes: ${payload.resumen.presentes} · Ausentes: ${payload.resumen.ausentes}`,
        }),
      ],
      spacing: { after: 160 },
    }),
    new Paragraph({
      text: "Listado de asistentes",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 160, after: 120 },
    }),
    createDataTable(
      ["Nombre", "Categoría", "Estado", "Email", "Tarjeta", "Calidad"],
      asistentesRows.length ? asistentesRows : [["—", "—", "—", "—", "—", "—"]]
    ),
    new Paragraph({
      text: "Acreencias del proceso",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 240, after: 120 },
    }),
    createDataTable(
      ["Acreedor", "Apoderado", "Naturaleza", "Prelación", "Capital", "Int. Cte.", "Int. Mora", "Otros", "Total", "%"],
      acreenciasRows.length ? acreenciasRows : [["—", "—", "—", "—", "—", "—", "—", "—", "—", "—"]]
    ),
    new Paragraph({
      text: `Generado por AutoActas el ${new Date().toLocaleString("es-CO")}`,
      spacing: { before: 240 },
    }),
  ];

  const doc = new Document({
    sections: [{ children: sections }],
  });

  return Packer.toBuffer(doc);
}

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as TerminarAudienciaPayload;

    if (!payload?.procesoId) {
      return NextResponse.json({ error: "Missing procesoId." }, { status: 400 });
    }
    if (!payload?.fecha) {
      return NextResponse.json({ error: "Missing fecha." }, { status: 400 });
    }

    const safeTitle = (payload.titulo || "audiencia")
      .trim()
      .replace(/[^\p{L}\p{N}\s._-]+/gu, "")
      .replace(/\s+/g, " ")
      .slice(0, 80);

    const fileName = `${payload.numeroProceso?.trim() || payload.procesoId} - ${payload.fecha} - ${
      safeTitle || "Audiencia"
    }.docx`;

    const buffer = await buildDocx(payload);

    const uploaded = await uploadDocxToGoogleDrive({
      filename: fileName,
      buffer,
      folderId: process.env.GOOGLE_DRIVE_FOLDER_ID ?? null,
    });

    return NextResponse.json({
      fileId: uploaded.id,
      fileName: uploaded.name,
      webViewLink: uploaded.webViewLink ?? null,
      webContentLink: uploaded.webContentLink ?? null,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "Failed to terminar audiencia.", detail: toErrorMessage(e) },
      { status: 500 }
    );
  }
}

