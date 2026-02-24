import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  Document,
  Header,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  LevelFormat,
  ImageRun,
  Tab,
  TabStopType,
  convertInchesToTwip,
} from "docx";
import { promises as fs } from "fs";
import path from "path";

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

async function loadFundaseerHeader(): Promise<Header | null> {
  const leftPath = path.join(process.cwd(), "fundaseer.png");
  const rightPath = path.join(process.cwd(), "ministeriodelderecho.png");

  let leftLogo: Buffer | null = null;
  let rightLogo: Buffer | null = null;

  try {
    leftLogo = await fs.readFile(leftPath);
  } catch (error) {
    console.warn(
      "[crear-auto-admisorio] Unable to load header image fundaseer.png:",
      error instanceof Error ? error.message : String(error),
    );
  }

  try {
    rightLogo = await fs.readFile(rightPath);
  } catch (error) {
    console.warn(
      "[crear-auto-admisorio] Unable to load header image ministeriodelderecho.png:",
      error instanceof Error ? error.message : String(error),
    );
  }

  if (!leftLogo && !rightLogo) return null;

  const leftSize = { width: 250, height: 184 };
  const rightSize = { width: 210, height: 45 };

  const leftLogoRun = leftLogo
    ? new ImageRun({
        type: "png",
        data: leftLogo,
        transformation: leftSize,
      })
    : null;

  const rightLogoRun = rightLogo
    ? new ImageRun({
        type: "png",
        data: rightLogo,
        transformation: rightSize,
      })
    : null;

  if (leftLogo && !rightLogo) {
    return new Header({
      children: [
        new Paragraph({
          alignment: AlignmentType.LEFT,
          children: [leftLogoRun!],
        }),
      ],
    });
  }

  if (!leftLogo && rightLogo) {
    return new Header({
      children: [
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [rightLogoRun!],
        }),
      ],
    });
  }

  return new Header({
    children: [
      new Paragraph({
        indent: { left: convertInchesToTwip(0.85) },
        tabStops: [
          {
            type: TabStopType.RIGHT,
            position: convertInchesToTwip(8.35),
          },
        ],
        children: [leftLogoRun!, new Tab(), rightLogoRun!],
      }),
    ],
  });
}

function safeDateKey() {
  return new Date().toISOString().slice(0, 10);
}

type DocImageType = "png" | "jpg" | "gif" | "bmp";
type DecodedSignatureImage = { data: Buffer; type: DocImageType };

function decodeSignatureDataUrl(dataUrl: string | null | undefined): DecodedSignatureImage | null {
  const raw = String(dataUrl ?? "").trim();
  if (!raw) return null;

  const match = raw.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match) return null;

  const subtypeRaw = match[1].toLowerCase();
  const base64 = match[2].replace(/\s+/g, "");
  if (!base64) return null;

  let type: DocImageType | null = null;
  if (subtypeRaw === "png") type = "png";
  if (subtypeRaw === "jpg" || subtypeRaw === "jpeg") type = "jpg";
  if (subtypeRaw === "gif") type = "gif";
  if (subtypeRaw === "bmp") type = "bmp";
  if (!type) return null;

  try {
    return { type, data: Buffer.from(base64, "base64") };
  } catch {
    return null;
  }
}

async function loadUsuarioFirmaDataUrlByEmail(
  supabase: ReturnType<typeof createSupabaseAdmin>,
  email: string | null | undefined,
): Promise<string | null> {
  if (!supabase) return null;

  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  if (!normalizedEmail) return null;

  const { data, error } = await supabase
    .from("usuarios")
    .select("firma_data_url")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (error) {
    console.warn("[crear-auto-admisorio] Unable to load usuario signature by email:", toErrorMessage(error));
    return null;
  }

  const firma = data?.firma_data_url;
  return typeof firma === "string" && firma.trim() ? firma : null;
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

function indentedParagraph(
  text: string,
  opts?: { leftInches?: number; rightInches?: number; bold?: boolean; spacingAfter?: number },
): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: opts?.spacingAfter ?? 120 },
    indent: {
      ...(typeof opts?.leftInches === "number" ? { left: convertInchesToTwip(opts.leftInches) } : {}),
      ...(typeof opts?.rightInches === "number" ? { right: convertInchesToTwip(opts.rightInches) } : {}),
    },
    children: [new TextRun({ text, font: FONT, size: SIZE_11, bold: opts?.bold ?? false })],
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
    let operadorFirmaDataUrl: string | null = null;

    // Look up the logged-in user's profile from the usuarios table
    const authUserId = body?.authUserId?.trim();
    if (authUserId) {
      const { data: usuario } = await supabase
        .from("usuarios")
        .select("nombre, email, identificacion, tarjeta_profesional, firma_data_url")
        .eq("auth_id", authUserId)
        .maybeSingle();

      if (usuario) {
        operador = {
          nombre: usuario.nombre || operador.nombre,
          identificacion: usuario.identificacion || operador.identificacion,
          tarjetaProfesional: usuario.tarjeta_profesional || operador.tarjetaProfesional,
          email: usuario.email || operador.email,
        };
        operadorFirmaDataUrl = usuario.firma_data_url || null;
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

    if (!operadorFirmaDataUrl) {
      operadorFirmaDataUrl = await loadUsuarioFirmaDataUrlByEmail(supabase, operador.email);
    }
    const operadorSignatureImage = decodeSignatureDataUrl(operadorFirmaDataUrl);
    const docHeader = await loadFundaseerHeader();

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
                header: convertInchesToTwip(0.2),
              },
            },
          },
          headers: docHeader ? { default: docHeader } : undefined,
          children: [
            // --- HEADER ---
            centeredBold("AUTO DE ADMISIÓN", SIZE_14),
            centeredBold("PROCEDIMIENTO DE NEGOCIACIÓN DE DEUDAS", SIZE_12),
            centeredBold("LEY 1564 DE 2012, MODIFICADA POR LA LEY 2445 DE 2025.", SIZE_12),

            emptyLine(),

            // --- INTRO ---
            bodyParagraph(
              "El suscrito Conciliador Extrajudicial en Derecho y Operador en Insolvencias,"
            ),
            bodyParagraph(
              "designado por el Centro de Conciliación FUNDASEER, en uso de las facultades conferidas por la Ley 1564 de 2012 —Código General del Proceso— modificada por la Ley 2445 de 2025, y en especial por lo dispuesto en sus artículos 531 a 574, procede a resolver sobre la solicitud de negociación de deudas presentada de conformidad con las siguientes:"
            ),

            emptyLine(),

            // --- CONSIDERACIONES ---
            centeredBold("CONSIDERACIONES DEL DESPACHO:", SIZE_12),

            emptyLine(),

            bodyParagraph(
              "Evaluados los documentos suministrados por la parte deudora, se establece que cumple con los requisitos exigidos por la ley para ser admitida al trámite de negociación de deudas, en atención a lo siguiente:"
            ),

            numberedItem(
              NUMBERED_CONSIDERACIONES,
              "La parte deudora se encuentra dentro de los parámetros establecidos en el artículo 532 del Código General del Proceso, modificado por la Ley 2445 de 2025, lo cual se comprueba mediante declaración juramentada y revisión de la información aportada."
            ),

            numberedItem(
              NUMBERED_CONSIDERACIONES,
              "Se configuran los supuestos de insolvencia previstos en el artículo 538 del C.G.P., toda vez que la parte deudora: es persona natural no comerciante, se encuentra en cesación de pagos con múltiples obligaciones vencidas por más de noventa (90) días, frente a varios acreedores y el valor de dichas obligaciones representa más del treinta por ciento (30%) del pasivo total."
            ),

            numberedItem(
              NUMBERED_CONSIDERACIONES,
              "La parte deudora allegó la relación completa de acreedores conforme al orden de prelación de créditos establecido en los artículos 2488 y siguientes del Código Civil."
            ),

            numberedItem(
              NUMBERED_CONSIDERACIONES,
              "Conforme al artículo 539 del C.G.P., la parte deudora ha cumplido con los requisitos de la solicitud de negociación de deudas, anexando la información sobre obligaciones, bienes y procesos judiciales en curso."
            ),

            numberedItem(
              NUMBERED_CONSIDERACIONES,
              `Este Centro de Conciliación es competente en razón al domicilio de la parte deudora, ubicado en la ciudad de ${ciudad} (art. 535 C.G.P.).`
            ),

            numberedItem(
              NUMBERED_CONSIDERACIONES,
              "Dando cumplimiento al artículo 536 del C.G.P., se verificó que fueron canceladas en su totalidad las costas correspondientes al presente trámite."
            ),

            numberedItem(
              NUMBERED_CONSIDERACIONES,
              "En mérito de lo expuesto y con fundamento en los artículos 531 a 574 del Código General del Proceso, se concluye que procede la admisión de la solicitud de negociación de deudas."
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
              { text: ", el presente Trámite de Negociación de Deudas de Persona Natural no Comerciante del señor " },
              { text: `  ${deudorNombre} `, bold: true },
              { text: `quien se identifica con la cédula de ciudadanía No. ${deudorIdentificacion}.` },
            ]),

            // 2. Fijar fecha...
            numberedMixed(NUMBERED_RESUELVE, [
              { text: "FIJAR FECHA PARA LA AUDIENCIA DE NEGOCIACION", bold: true },
              { text: `, ${fechaAudienciaTexto}.` },
            ]),

            numberedItem(
              NUMBERED_RESUELVE,
              `ORDENAR al deudor, señor ${deudorNombre}, que dentro de los cinco (5) días siguientes a la aceptación del trámite de negociación de deudas, presente una relación actualizada de cada una de sus obligaciones, bienes y procesos judiciales, incluyendo la totalidad de acreencias causadas hasta el día inmediatamente anterior a la aceptación, conforme a la prelación de créditos establecida en el Código Civil, normas concordantes y jurisprudencia constitucional. La ausencia de esta actualización se tendrá como manifestación de que la relación presentada con la solicitud no ha variado. Cualquier cambio relevante de la situación del deudor que suceda entre la aceptación de la negociación de deudas y la apertura de la liquidación patrimonial, en relación con su crisis económica, deberá ser comunicado a los acreedores a través del conciliador, a efecto de que aquellos lo puedan tener en cuenta al momento de tomar las decisiones que les correspondan. Igualmente, deberá informar cualquier cambio de domicilio, residencia o direcciones física y electrónica de notificación.`
            ),

            numberedItem(
              NUMBERED_RESUELVE,
              "NOTIFICAR al deudor y a los acreedores señalados en la solicitud, en las direcciones físicas o electrónicas suministradas."
            ),

            numberedItem(
              NUMBERED_RESUELVE,
              "COMUNICAR esta decisión a la DIAN, Secretaría de Hacienda Municipal y Departamental, y a la Unidad de Gestión Pensional y Parafiscales (UGPP); así como a las autoridades jurisdiccionales y administrativas, empresas de servicios públicos, pagadores y particulares que adelanten procesos civiles de cobranza, a fin de que se sujeten a los efectos de esta providencia."
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

            numberedItem(
              NUMBERED_RESUELVE,
              "ADVERTIR a la parte convocante que de conformidad con el artículo 549 del Código General del Proceso, el incumplimiento en el pago de los gastos de administración será causal de fracaso del Procedimiento de Negociación de Deudas que se celebrará en la fecha ya indicada."
            ),

            numberedItem(
              NUMBERED_RESUELVE,
              "ADVERTIR a los acreedores, de conformidad con lo ordenado en el artículo 545 del Código General del Proceso, modificado por la Ley 2445 de 2025, que a partir de la aceptación de la solicitud de negociación de deudas:"
            ),

            indentedParagraph(
              "6.1 Se prohíbe al deudor realizar pagos, compensaciones, daciones en pago, arreglos, desistimientos, allanamientos, terminaciones unilaterales o de mutuo acuerdo de procesos en curso, así como conciliaciones o transacciones respecto de obligaciones causadas con anterioridad a la aceptación de la solicitud, o sobre bienes que para ese momento formen parte de su patrimonio. Igualmente, los acreedores no podrán ejecutar las garantías constituidas sobre dichos bienes.",
              { leftInches: 0.5 }
            ),

            indentedParagraph(
              "6.2 No podrán iniciarse contra el deudor nuevos procesos o trámites, públicos o privados, de ejecución, jurisdicción coactiva, cobro de obligaciones dinerarias, ejecución especial o restitución de bienes por mora en el pago de cánones. En consecuencia, se suspenderán los procesos en curso a la fecha de aceptación de la solicitud. La suspensión incluirá la ejecución aún no practicada en su totalidad de medidas cautelares previamente decretadas sobre bienes, derechos o emolumentos del deudor, incluyendo aquellos que este tenga por recibir, ya sea personalmente, en cuentas bancarias o a través de productos financieros, así como los actos preparatorios para el perfeccionamiento de dichas medidas.",
              { leftInches: 0.5 }
            ),

            indentedParagraph(
              "6.3 No podrán iniciarse contra el deudor nuevos procesos o trámites, públicos o privados, de ejecución, jurisdicción coactiva, cobro de obligaciones dinerarias, ejecución especial o restitución de bienes por mora en el pago de cánones. En consecuencia, se suspenderán los procesos en curso a la fecha de aceptación de la solicitud. La suspensión incluirá la ejecución aún no practicada en su totalidad de medidas cautelares previamente decretadas sobre bienes, derechos o emolumentos del deudor, incluyendo aquellos que este tenga por recibir, ya sea personalmente, en cuentas bancarias o a través de productos financieros, así como los actos preparatorios para el perfeccionamiento de dichas medidas.",
              { leftInches: 0.5 }
            ),

            indentedParagraph(
              "6.4 Toda actuación judicial o extrajudicial de cobro realizada luego de la aceptación del trámite, y habiendo sido comunicado directamente el acreedor titular o cesionario sobre la admisión del deudor a un procedimiento de insolvencia, acarreará las siguientes sanciones progresivas:",
              { leftInches: 0.5 }
            ),

            indentedParagraph("PRIMERA OCASIÓN: llamado de atención.", { leftInches: 0.8 }),
            indentedParagraph("SEGUNDA OCASIÓN: amonestación formal.", { leftInches: 0.8 }),
            indentedParagraph("TERCERA OCASIÓN: postergación del pago de las acreencias calificadas o por calificar a favor del acreedor.", { leftInches: 0.8 }),
            indentedParagraph(
              "CUARTA Y SIGUIENTES OCASIONES: remisión de queja, con pruebas, a la Superintendencia Financiera o a la Superintendencia de Industria y Comercio, según corresponda, para que se imponga una multa del 10 % del valor del crédito cobrado, incluidos intereses, conforme a la Ley 2300 de 2023, sin perjuicio de los límites previstos en el artículo 18 de la Ley Estatutaria 1266 de 2008.",
              { leftInches: 0.8 }
            ),

            indentedParagraph(
              "6.5 No podrá suspenderse la prestación de servicios públicos domiciliarios, ni en la residencia habitual ni en el lugar de trabajo del deudor, por mora en obligaciones causadas con anterioridad a la aceptación de la solicitud. En caso de que se haya suspendido el servicio, este deberá restablecerse de manera inmediata, y los valores causados posteriormente se tratarán como gastos de administración.",
              { leftInches: 0.5 }
            ),

            indentedParagraph(
              "6.6 La regla anterior será aplicable a todo contrato de tracto sucesivo, tales como arrendamientos, servicios de educación, salud, administración de propiedad horizontal y similares. La desatención a esta obligación generará igualmente las sanciones descritas en el numeral 6.4.",
              { leftInches: 0.5 }
            ),

            numberedItem(
              NUMBERED_RESUELVE,
              "ORDENAR desde la fecha de esta acta, la suspensión de todo tipo de pagos, descuentos automáticos, descuentos de nómina o de productos financieros, libranzas, retenciones o cualquier otra forma de prerrogativa relacionada con el pago o abono automático o directo del acreedor o de mandatario suyo que se haya pactado contractualmente o que disponga la ley, excepto los relacionados con las obligaciones alimentarias del deudor. Los actos que se ejecuten en contravención a esta disposición serán ineficaces de pleno derecho. Esta sanción será puesta en conocimiento del pagador y del acreedor correspondiente por el conciliador, junto con la orden de devolución inmediata al deudor de las sumas pagadas o descontadas. Para tal efecto, el pagador y el acreedor serán solidariamente responsables a partir del momento en que hayan recibido la comunicación. Además, se impondrán las sanciones establecidas en el numeral 6.4 de esta providencia."
            ),

            numberedItem(
              NUMBERED_RESUELVE,
              "ORDENAR a todos los acreedores la suspensión inmediata de cualquier forma de cobro o actuación judicial, extrajudicial, directa o indirecta contra el deudor, desde la fecha de aceptación del trámite de negociación de deudas. Esta prohibición incluye gestiones telefónicas, domiciliarias, comunicaciones digitales, reportes intimidatorios o cualquier otra medida dirigida a presionar el pago de obligaciones incluidas en el trámite."
            ),

            numberedItem(
              NUMBERED_RESUELVE,
              "ADVERTIR al deudor que no podrá iniciar un nuevo trámite de insolvencia hasta que se cumpla el término previsto en el artículo 574 del Código General del Proceso, conforme a la ley vigente."
            ),

            numberedItem(
              NUMBERED_RESUELVE,
              "NOTIFICAR a las partes que, a partir de la presente decisión, se interrumpirá el término de prescripción y no operará la caducidad de las acciones respecto de los créditos que contra el deudor se hubieren hecho exigibles antes de la iniciación de dicho trámite."
            ),

            numberedItem(
              NUMBERED_RESUELVE,
              "ADVERTIR que el pago de impuestos prediales, cuotas de administración, servicios públicos y cualquier otra tasa o contribución necesarios para obtener la paz y salvo en la enajenación de inmuebles o cualquier otro bien sujeto a registro, solo podrá exigirse respecto de aquellas acreencias causadas con posterioridad a la aceptación de la solicitud. Las restantes quedarán sujetas a los términos del acuerdo o a las resultas del procedimiento de liquidación patrimonial. Este tratamiento se aplicará a toda obligación propter rem que afecte los bienes del deudor."
            ),

            numberedItem(
              NUMBERED_RESUELVE,
              "INFORMAR a las entidades que administran bases de datos de carácter financiero, crediticio, comercial y de servicios sobre la aceptación de esta solicitud, en los términos del artículo 573 del Código General del Proceso."
            ),

            numberedItem(
              NUMBERED_RESUELVE,
              "LA PERSONA SOLICITANTE podrá retirar su solicitud de negociación mientras no se hubiere hecho efectivo ninguno de los efectos previstos en los numerales 1 y 2 del artículo 545 de la Ley 2445 de 2025, y podrá desistir expresamente del procedimiento mientras no se haya aprobado el acuerdo. Al desistimiento se aplicarán, en lo pertinente, los artículos 314 a 316 del Código General del Proceso, pero no habrá lugar a condena en costas, y su aceptación conllevará la reanudación inmediata de los procedimientos de ejecución suspendidos, para lo cual el conciliador oficiará con destino a los funcionarios y particulares correspondientes, al día siguiente de que esta se produzca. La indemnización de perjuicios que pretendan los acreedores se tramitará ante el juez del proceso suspendido o, en su defecto, ante el que señala el artículo 534 de la Ley 2445 de 2025."
            ),

            numberedItem(
              NUMBERED_RESUELVE,
              "ORDENAR la inscripción del presente auto en los folios de matrícula inmobiliaria de los bienes sujetos a registro público de propiedad del deudor."
            ),

            numberedItem(
              NUMBERED_RESUELVE,
              "LAS CONTROVERSIAS relacionadas con la aceptación de la solicitud de negociación de deudas solamente se podrán proponer al iniciarse la primera sesión de la audiencia correspondiente."
            ),

            emptyLine(),

            // --- FIRMA ---
            bodyParagraph(`En constancia de lo anterior se firma el ${fechaFirmaTexto}.`),

            emptyLine(),

            bodyParagraph("Atentamente,"),

            ...(operadorSignatureImage
              ? [
                  new Paragraph({
                    spacing: { after: 140 },
                    children: [
                      new ImageRun({
                        type: operadorSignatureImage.type,
                        data: operadorSignatureImage.data,
                        transformation: { width: 190, height: 70 },
                      }),
                    ],
                  }),
                ]
              : [emptyLine(), emptyLine(), emptyLine()]),

            // Signature block
            new Paragraph({
              spacing: { after: 40 },
              children: [
                new TextRun({ text: operador.nombre.toUpperCase(), bold: true, font: FONT, size: SIZE_11 }),
              ],
            }),
            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              spacing: { after: 120 },
              children: [
                new TextRun({
                  text: "Conciliador Extrajudicial en Derecho y Operador en Insolvencias",
                  font: FONT,
                  size: SIZE_11,
                }),
                new TextRun({
                  text: `C. C. No. ${operador.identificacion}`,
                  break: 1,
                  font: FONT,
                  size: SIZE_11,
                }),
              ],
            }),
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
