import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Document, Packer, Paragraph, TextRun, AlignmentType, LevelFormat, convertInchesToTwip } from "docx";

import { uploadDocxToGoogleDrive } from "@/lib/google-drive";
import type { Database } from "@/lib/database.types";

export const runtime = "nodejs";

type Payload = {
  procesoId: string;
  authUserId?: string; // Supabase auth.users.id of the logged-in user
  ciudad?: string;
  fechaAudiencia?: string; // YYYY-MM-DD
  horaAudiencia?: string;  // HH:MM (24h)
  operador?: {
    nombre: string;
    identificacion: string;
    tarjetaProfesional?: string;
    email?: string;
  };
};

function toErrorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") return JSON.stringify(e, Object.getOwnPropertyNames(e));
  return String(e);
}

function createSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !serviceKey) return null;
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, detectSessionInUrl: false },
  });
}

function safeDateKey() {
  return new Date().toISOString().slice(0, 10);
}

// --- Spanish date helpers ---

const UNIDADES = [
  "", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve",
  "diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete",
  "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés",
  "veinticuatro", "veinticinco", "veintiséis", "veintisiete", "veintiocho", "veintinueve",
  "treinta", "treinta y uno",
];

function numberToSpanish(n: number): string {
  if (n >= 0 && n < UNIDADES.length) return UNIDADES[n];
  return String(n);
}

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

function formatFechaEnLetras(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) return dateStr;
  const dayWord = numberToSpanish(day);
  const monthName = MESES[month] ?? "";
  return `${dayWord} (${day}) de ${monthName} del año ${year}`;
}

function formatFechaAudienciaLarga(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const day = parseInt(parts[2], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[0], 10);
  if (Number.isNaN(day) || Number.isNaN(month) || Number.isNaN(year)) return dateStr;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(day)} de ${MESES[month] ?? ""} de ${year}`;
}

function formatHora12(horaHHMM: string | undefined): string {
  if (!horaHHMM) return "";
  const match = horaHHMM.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return horaHHMM;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const meridiem = h >= 12 ? "p.m." : "a.m.";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (m === 0) return `${h12} ${meridiem}`;
  return `${h12}:${String(m).padStart(2, "0")} ${meridiem}`;
}

// --- Paragraph helpers ---

const FONT = "Arial";
const SIZE_11 = 22; // 11pt in half-points
const SIZE_12 = 24;
const SIZE_14 = 28;

const NUMBERED_CONSIDERACIONES = "consideraciones-numbered";
const NUMBERED_RESUELVE = "resuelve-numbered";
const BULLET_GASTOS = "gastos-bullet";

function emptyLine(): Paragraph {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text: "", font: FONT, size: SIZE_11 })],
  });
}

function centeredBold(text: string, size = SIZE_14): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
    children: [new TextRun({ text, bold: true, font: FONT, size })],
  });
}

function bodyParagraph(text: string, opts?: { bold?: boolean; allCaps?: boolean }): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 120 },
    children: [
      new TextRun({
        text,
        font: FONT,
        size: SIZE_11,
        bold: opts?.bold ?? false,
        allCaps: opts?.allCaps ?? false,
      }),
    ],
  });
}

function numberedItem(reference: string, text: string): Paragraph {
  return new Paragraph({
    numbering: { reference, level: 0 },
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 120 },
    children: [new TextRun({ text, font: FONT, size: SIZE_11 })],
  });
}

function numberedMixed(reference: string, runs: { text: string; bold?: boolean }[]): Paragraph {
  return new Paragraph({
    numbering: { reference, level: 0 },
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 120 },
    children: runs.map(
      (r) =>
        new TextRun({
          text: r.text,
          font: FONT,
          size: SIZE_11,
          bold: r.bold ?? false,
        })
    ),
  });
}

function bulletItem(reference: string, text: string): Paragraph {
  return new Paragraph({
    numbering: { reference, level: 0 },
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 100 },
    children: [new TextRun({ text, font: FONT, size: SIZE_11 })],
  });
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as Payload | null;
    const procesoId = body?.procesoId?.trim();
    if (!procesoId) {
      return NextResponse.json({ error: "Missing procesoId" }, { status: 400 });
    }

    const supabase = createSupabaseAdmin();
    if (!supabase) {
      return NextResponse.json({ error: "Missing Supabase server configuration." }, { status: 500 });
    }

    // --- Fetch data ---
    const { data: proceso, error: procesoError } = await supabase
      .from("proceso")
      .select("id, numero_proceso, fecha_procesos, juzgado, tipo_proceso, descripcion, estado")
      .eq("id", procesoId)
      .single();

    if (procesoError) {
      return NextResponse.json({ error: "Unable to load proceso.", detail: toErrorMessage(procesoError) }, { status: 500 });
    }

    const { data: deudores } = await supabase
      .from("deudores")
      .select("nombre, identificacion, tipo_identificacion, apoderado_id")
      .eq("proceso_id", procesoId);

    const { data: acreedores } = await supabase
      .from("acreedores")
      .select("apoderado_id")
      .eq("proceso_id", procesoId);

    // Collect all apoderado IDs from deudores + acreedores + direct proceso link
    const apoderadoIds = new Set<string>();
    (deudores ?? []).forEach((d) => { if (d.apoderado_id) apoderadoIds.add(d.apoderado_id); });
    (acreedores ?? []).forEach((a) => { if (a.apoderado_id) apoderadoIds.add(a.apoderado_id); });

    // Fetch apoderados by proceso_id AND by referenced IDs
    const { data: apoderadosByProceso } = await supabase
      .from("apoderados")
      .select("id, email")
      .eq("proceso_id", procesoId);

    const apoderadosByIds = apoderadoIds.size > 0
      ? (await supabase.from("apoderados").select("id, email").in("id", Array.from(apoderadoIds))).data ?? []
      : [];

    // Merge and deduplicate
    const allApoderadosMap = new Map<string, string | null>();
    for (const ap of [...(apoderadosByProceso ?? []), ...apoderadosByIds]) {
      if (!allApoderadosMap.has(ap.id)) allApoderadosMap.set(ap.id, ap.email);
    }

    // Get the next scheduled event for the audiencia date
    const { data: eventos } = await supabase
      .from("eventos")
      .select("fecha, hora")
      .eq("proceso_id", procesoId)
      .order("fecha", { ascending: true })
      .limit(5);

    // --- Resolve variables ---
    const numeroProceso = proceso?.numero_proceso?.trim() || procesoId;
    const fechaKey = safeDateKey();
    const ciudad = body?.ciudad?.trim() || "Cali";

    const primerDeudor = (deudores ?? [])[0];
    const deudorNombre = primerDeudor?.nombre?.toUpperCase() ?? "SIN NOMBRE";
    const deudorIdentificacion = primerDeudor?.identificacion ?? "SIN IDENTIFICACIÓN";

    // Audiencia date: use payload, or first future event, or fallback
    let fechaAudiencia = body?.fechaAudiencia?.trim() || "";
    let horaAudiencia = body?.horaAudiencia?.trim() || "";
    if (!fechaAudiencia && eventos && eventos.length > 0) {
      const futuro = eventos.find((e) => e.fecha >= fechaKey) ?? eventos[0];
      fechaAudiencia = futuro.fecha ?? "";
      horaAudiencia = horaAudiencia || futuro.hora || "";
    }

    const fechaAudienciaTexto = fechaAudiencia
      ? `para el día ${formatFechaAudienciaLarga(fechaAudiencia)}${horaAudiencia ? ` a las ${formatHora12(horaAudiencia)}` : ""}`
      : "(fecha por definir)";

    // Fecha de firma (today)
    const fechaFirmaTexto = formatFechaEnLetras(fechaKey);

    // Operador/Conciliador — resolve from logged-in user, then payload override, then defaults
    let operador = {
      nombre: "JUAN CAMILO ROMERO BURGOS",
      identificacion: "1.143.941.218",
      tarjetaProfesional: "334936 del C S de la J.",
      email: "grupodeapoyojuridico1@gmail.com",
    };

    // Look up the logged-in user's profile from the usuarios table
    const authUserId = body?.authUserId?.trim();
    if (authUserId) {
      const { data: usuario } = await supabase
        .from("usuarios")
        .select("nombre, email, identificacion, tarjeta_profesional")
        .eq("auth_id", authUserId)
        .maybeSingle();

      if (usuario) {
        operador = {
          nombre: usuario.nombre || operador.nombre,
          identificacion: usuario.identificacion || operador.identificacion,
          tarjetaProfesional: usuario.tarjeta_profesional || operador.tarjetaProfesional,
          email: usuario.email || operador.email,
        };
      }
    }

    // Payload operador overrides anything from DB
    if (body?.operador) {
      operador = {
        nombre: body.operador.nombre || operador.nombre,
        identificacion: body.operador.identificacion || operador.identificacion,
        tarjetaProfesional: body.operador.tarjetaProfesional || operador.tarjetaProfesional,
        email: body.operador.email || operador.email,
      };
    }

    // --- Build document ---
    const doc = new Document({
      numbering: {
        config: [
          {
            reference: NUMBERED_CONSIDERACIONES,
            levels: [
              {
                level: 0,
                format: LevelFormat.DECIMAL,
                text: "%1.",
                alignment: AlignmentType.START,
                style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.3) } } },
              },
            ],
          },
          {
            reference: NUMBERED_RESUELVE,
            levels: [
              {
                level: 0,
                format: LevelFormat.DECIMAL,
                text: "%1.",
                alignment: AlignmentType.START,
                style: { paragraph: { indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.3) } } },
              },
            ],
          },
          {
            reference: BULLET_GASTOS,
            levels: [
              {
                level: 0,
                format: LevelFormat.BULLET,
                text: "\u2022",
                alignment: AlignmentType.START,
                style: { paragraph: { indent: { left: convertInchesToTwip(0.8), hanging: convertInchesToTwip(0.3) } } },
              },
            ],
          },
        ],
      },
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: convertInchesToTwip(1),
                bottom: convertInchesToTwip(1),
                left: convertInchesToTwip(1.18),
                right: convertInchesToTwip(1.18),
              },
            },
          },
          children: [
            // --- HEADER ---
            centeredBold("AUTO DE ADMISIÓN", SIZE_14),
            centeredBold("PROCEDIMIENTO DE NEGOCIACIÓN DE DEUDAS", SIZE_12),
            centeredBold("LEY 1564 DE 2012, MODIFICADA POR LA LEY 2445 DE 2025.", SIZE_12),

            emptyLine(),

            // --- INTRO ---
            bodyParagraph(
              "EL SUSCRITO CONCILIADOR, designado por el Centro de Conciliación FUNDASEER, teniendo en cuenta que la aceptación del encargo es obligatoria y que no pesa sobre mi ningún impedimento para adelantar el presente Trámite de Insolvencia de la Persona Natural No Comerciante en uso de las atribuciones consagradas en la Ley 1564 de 2012, en particular por el Artículo 541 y S. S. de la misma ley,"
            ),

            emptyLine(),

            // --- CONSIDERACIONES ---
            centeredBold("CONSIDERACIONES DEL DESPACHO:", SIZE_12),

            emptyLine(),

            bodyParagraph(
              "Evaluados los documentos suministrados por la parte deudora, se establece que cumple con los requisitos exigidos por la ley para ser admitida al trámite de negociación de deudas, por lo siguiente:"
            ),

            // Numbered items 1-5
            numberedItem(
              NUMBERED_CONSIDERACIONES,
              "La parte deudora se encuentra dentro de los parámetros establecidos en el artículo 532 del Código general del proceso, modificado por la ley 2445 de 2025. Esto se comprueba mediante la declaración juramentada de la parte deudora mediante la revisión de la información aportada."
            ),

            numberedItem(
              NUMBERED_CONSIDERACIONES,
              "Cumple con todos los supuestos de insolvencia."
            ),

            numberedItem(
              NUMBERED_CONSIDERACIONES,
              `Que este Centro de Conciliación es competente en razón al domicilio de la parte interesada ya que su domicilio se encuentra en la ciudad de ${ciudad}.`
            ),

            numberedItem(
              NUMBERED_CONSIDERACIONES,
              "Conforme al análisis de cumplimiento, se concluye que la parte deudora ha cumplido con todos los requisitos de la solicitud de trámite de negociación de deudas del artículo 539 del C. G. P."
            ),

            numberedItem(
              NUMBERED_CONSIDERACIONES,
              "Dando cumplimiento al artículo 536 de la Ley 1564 de 2012, se concluye que los interesados cumplieron oportunamente, con la obligación de cancelar, en su totalidad, las costas del presente trámite."
            ),

            emptyLine(),

            bodyParagraph("Por lo anterior este Operador Judicial en Insolvencia Económica."),

            emptyLine(),

            // --- RESUELVE ---
            centeredBold("RESUELVE", SIZE_14),

            emptyLine(),

            // 1. Certificar...
            numberedMixed(NUMBERED_RESUELVE, [
              { text: "Certificar el cumplimiento de todos los requisitos de Procedibilidad " },
              { text: "Y DECLARAR ABIERTO", bold: true },
              { text: `, el presente Trámite de Negociación de Deudas de Persona Natural no Comerciante del señor ` },
              { text: `  ${deudorNombre} `, bold: true },
              { text: `quien se identifica con la cédula de ciudadanía No. ${deudorIdentificacion}` },
            ]),

            // 2. Fijar fecha...
            numberedMixed(NUMBERED_RESUELVE, [
              { text: "FIJAR FECHA PARA LA AUDIENCIA DE NEGOCIACION", bold: true },
              { text: `, ${fechaAudienciaTexto}.` },
            ]),

            // 3. Comunicar...
            numberedItem(
              NUMBERED_RESUELVE,
              "Comunicar a los despachos judiciales, centrales de riesgo y entidades administrativas de la suspensión de los procesos en curso en razón a la admisión del PROCEDIMIENTO DE NEGOCIACIÓN DE DEUDAS."
            ),

            // 4. Sobre los efectos...
            numberedItem(
              NUMBERED_RESUELVE,
              "Sobre los efectos de la aceptación de su trámite de insolvencia, en especial, su deber de actualizar dentro de los cinco (5) días siguientes a la admisión de este trámite la información presentada en su solicitud."
            ),

            // 5. Gastos de administración...
            numberedMixed(NUMBERED_RESUELVE, [
              { text: "Conforme al artículo 549 del Código General del proceso, tener como " },
              { text: "GASTOS DE ADMINISTRACIÓN", bold: true },
              { text: " los siguientes emolumentos:" },
            ]),

            // Bullet sub-items under gastos
            bulletItem(
              BULLET_GASTOS,
              "Los gastos de asesoría y representación legal en caso de contar LA PARTE DEUDORA con un abogado que la represente."
            ),

            bulletItem(
              BULLET_GASTOS,
              "Tarifas de Procedimiento de Insolvencia por concepto de reliquidación y sesiones adicionales de conformidad con los artículos 30 y 31 del Decreto 2677 de 2012."
            ),

            bulletItem(
              BULLET_GASTOS,
              "Gastos necesarios para la subsistencia del deudor, la adecuada conservación de sus bienes y la debida atención de su alimentación, vestuario y acreedores, tal como fueron relacionados por la parte deudora en su solicitud."
            ),

            bulletItem(
              BULLET_GASTOS,
              "Las cuotas alimentarias subsiguientes que deberá de seguir sufragando a favor de sus hijos, si los tienen."
            ),

            // 6. Advertir parte convocante...
            numberedItem(
              NUMBERED_RESUELVE,
              "Advertir a la parte convocante que de conformidad con el artículo 549 del Código General del Proceso, el incumplimiento en el pago de los gastos de administración será causal de fracaso del Procedimiento de Negociación de Deudas que se celebrará en la fecha ya indicada."
            ),

            // 7. Advertir al deudor...
            numberedItem(
              NUMBERED_RESUELVE,
              "Advertir al deudor que le está prohibido otorgar garantías o la adquisición de nuevos créditos sin el consentimiento de los acreedores que representen la mitad más uno del valor de los pasivos."
            ),

            emptyLine(),

            // --- FIRMA ---
            bodyParagraph(`En constancia de lo anterior se firma el ${fechaFirmaTexto}.`),

            emptyLine(),

            bodyParagraph("Atentamente,"),

            emptyLine(),
            emptyLine(),
            emptyLine(),

            // Signature block
            new Paragraph({
              spacing: { after: 40 },
              children: [
                new TextRun({ text: operador.nombre.toUpperCase(), bold: true, font: FONT, size: SIZE_11 }),
              ],
            }),
            bodyParagraph(
              `Conciliador Extrajudicial en Derecho y Operador en Insolvencias C. C. No. ${operador.identificacion}`
            ),
            bodyParagraph(
              `T. P. No. ${operador.tarjetaProfesional ?? ""}`
            ),
            bodyParagraph(
              `Email: ${operador.email ?? ""}`
            ),
          ],
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    const fileName = `AUTO_ADMISION_${numeroProceso}_${fechaKey}.docx`;
    const uploaded = await uploadDocxToGoogleDrive({
      filename: fileName,
      buffer,
    });

    // Collect apoderado emails for email notification
    const apoderadoEmails = Array.from(allApoderadosMap.values())
      .map((email) => email?.trim().toLowerCase())
      .filter((e): e is string => !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    const uniqueEmails = [...new Set(apoderadoEmails)];

    return NextResponse.json({
      fileId: uploaded.id,
      fileName: uploaded.name,
      webViewLink: uploaded.webViewLink ?? null,
      apoderadoEmails: uniqueEmails,
    });
  } catch (e) {
    return NextResponse.json({ error: "Unexpected error", detail: toErrorMessage(e) }, { status: 500 });
  }
}
