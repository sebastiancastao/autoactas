import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  PageOrientation,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
  BorderStyle,
  convertInchesToTwip,
} from "docx";

import { uploadDocxToGoogleDrive } from "@/lib/google-drive";
import type { Database } from "@/lib/database.types";

export const runtime = "nodejs";

type UsuarioEvento = Pick<Database["public"]["Tables"]["usuarios"]["Row"], "id" | "nombre" | "email">;
type EventoContext = { usuario: UsuarioEvento | null; horaHHMM: string | null };

type Asistente = {
  nombre: string;
  email?: string;
  categoria: string; // "Acreedor" | "Deudor" | "Apoderado"
  estado: string; // "Presente" | "Ausente"
  tarjetaProfesional?: string;
  calidadApoderadoDe?: string;
  identificacion?: string;
  nit?: string; // For entities like banks
};

type AcreenciaRow = {
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
};

type TerminarAudienciaPayload = {
  procesoId: string;
  numeroProceso?: string | null;
  titulo: string;
  fecha: string; // YYYY-MM-DD
  eventoId?: string | null;
  hora?: string; // HH:MM
  ciudad?: string;
  debug?: boolean;
  resumen: { total: number; presentes: number; ausentes: number };
  asistentes: Asistente[];
  acreencias: AcreenciaRow[];
  // Deudor info
  deudor?: {
    nombre: string;
    identificacion: string;
    tipoIdentificacion?: string;
  };
  // Operador/Conciliador info
  operador?: {
    nombre: string;
    identificacion: string;
    tarjetaProfesional?: string;
    email?: string;
  };
  // Next hearing info
  proximaAudiencia?: {
    fecha: string;
    hora?: string;
  };
  // Custom text sections
  resultadoDiligencia?: string;
  observacionesFinales?: string;
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

function normalizeHoraHHMM(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const h = match[1].padStart(2, "0");
  const m = match[2];
  return `${h}:${m}`;
}

async function loadEventoUsuario(params: {
  eventoId?: string | null;
  procesoId: string;
  fecha: string;
  hora?: string | null;
}): Promise<EventoContext | null> {
  const supabase = createSupabaseAdmin();
  if (!supabase) return null;

  const horaHHMM = normalizeHoraHHMM(params.hora ?? undefined);
  const horaCandidates = horaHHMM ? [horaHHMM, `${horaHHMM}:00`] : null;

  if (params.eventoId) {
    const { data: evt, error: evtErr } = await supabase
      .from("eventos")
      .select("id, usuario_id, hora")
      .eq("id", params.eventoId)
      .maybeSingle();

    if (evtErr) {
      console.warn("[terminar-audiencia] Unable to load evento by id:", evtErr.message);
      return null;
    }

    const eventoHora = normalizeHoraHHMM(evt?.hora ?? null);

    if (evt?.usuario_id) {
      const { data: usuario, error: userErr } = await supabase
        .from("usuarios")
        .select("id, nombre, email")
        .eq("id", evt.usuario_id)
        .maybeSingle();
      if (userErr) {
        console.warn("[terminar-audiencia] Unable to load usuario for evento:", userErr.message);
        return null;
      }
      return { usuario: (usuario ?? null) as UsuarioEvento | null, horaHHMM: eventoHora };
    }

    return { usuario: null, horaHHMM: eventoHora };
  }

  // Best-effort lookup by proceso + fecha (+ hora if present)
  const baseQuery = supabase
    .from("eventos")
    .select("id, usuario_id, hora, created_at")
    .eq("proceso_id", params.procesoId)
    .eq("fecha", params.fecha)
    .order("created_at", { ascending: false })
    .limit(1);

  const { data: evtByHora, error: evtByHoraErr } = horaCandidates
    ? await baseQuery.in("hora", horaCandidates).maybeSingle()
    : await baseQuery.maybeSingle();

  if (evtByHoraErr) {
    console.warn("[terminar-audiencia] Unable to load evento:", evtByHoraErr.message);
    return null;
  }

  const eventoHora = normalizeHoraHHMM(evtByHora?.hora ?? null);
  const usuarioId = evtByHora?.usuario_id ?? null;
  if (!usuarioId) return { usuario: null, horaHHMM: eventoHora };

  const { data: usuario, error: userErr } = await supabase
    .from("usuarios")
    .select("id, nombre, email")
    .eq("id", usuarioId)
    .maybeSingle();

  if (userErr) {
    console.warn("[terminar-audiencia] Unable to load usuario:", userErr.message);
    return null;
  }

  return { usuario: (usuario ?? null) as UsuarioEvento | null, horaHHMM: eventoHora };
}

function formatDateLong(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("es-CO", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatDateParts(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { day: "—", month: "—", year: "—" };
  return {
    day: parsed.getDate().toString(),
    month: parsed.toLocaleDateString("es-CO", { month: "long" }),
    year: parsed.getFullYear().toString(),
  };
}

type HoraActa = {
  time12: string; // h:mm
  meridiemLower: "a.m." | "p.m.";
  fullLower: string; // "h:mm a.m."
  fullUpper: string; // "h:mm A.M."
};

function getBogotaTime24hNow() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Bogota",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(new Date());

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");

  return {
    hour: Number.isFinite(hour) ? hour : 0,
    minute: Number.isFinite(minute) ? minute : 0,
  };
}

function pad2(n: number) {
  return String(Math.trunc(n)).padStart(2, "0");
}

function horaActaFrom24h(hour24: number, minute: number): HoraActa {
  const normalizedHour = ((Math.trunc(hour24) % 24) + 24) % 24;
  const normalizedMinute = ((Math.trunc(minute) % 60) + 60) % 60;

  const meridiemLower: HoraActa["meridiemLower"] = normalizedHour >= 12 ? "p.m." : "a.m.";
  const hour12 = normalizedHour % 12 === 0 ? 12 : normalizedHour % 12;
  const time12 = `${hour12}:${pad2(normalizedMinute)}`;

  return {
    time12,
    meridiemLower,
    fullLower: `${time12} ${meridiemLower}`,
    fullUpper: `${time12} ${meridiemLower.toUpperCase()}`,
  };
}

function resolveHoraActa(horaRaw: string | undefined | null): HoraActa {
  const trimmed = horaRaw?.trim();
  if (!trimmed) {
    const now = getBogotaTime24hNow();
    return horaActaFrom24h(now.hour, now.minute);
  }

  const match = trimmed.match(/^(\d{1,2}):(\d{2})(?:\s*([AaPp])\.?\s*[Mm]\.?)?$/);
  if (!match) {
    return {
      time12: trimmed,
      meridiemLower: "a.m.",
      fullLower: `${trimmed} a.m.`,
      fullUpper: `${trimmed} A.M.`,
    };
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    const now = getBogotaTime24hNow();
    return horaActaFrom24h(now.hour, now.minute);
  }

  if (match[3]) {
    const isPm = match[3].toLowerCase() === "p";
    const hour12Raw = ((Math.trunc(hour) % 12) + 12) % 12 || 12;
    const hour24 = isPm ? (hour12Raw % 12) + 12 : hour12Raw % 12;
    return horaActaFrom24h(hour24, minute);
  }

  return horaActaFrom24h(hour, minute);
}

function formatCurrency(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "$ 0";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercentage(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "0,00%";
  return value.toFixed(2).replace(".", ",") + "%";
}

function isValidEmail(email: string | undefined | null): email is string {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function formatListRunsWithY(items: string[], opts?: { bold?: boolean; transform?: (s: string) => string }) {
  const out: TextRun[] = [];
  const bold = opts?.bold ?? false;
  const transform = opts?.transform ?? ((s: string) => s);

  items.forEach((raw, idx) => {
    const item = raw.trim();
    if (!item) return;

    if (out.length > 0) {
      const isLast = idx === items.length - 1;
      out.push(new TextRun({ text: isLast ? " Y " : ", " }));
    }
    out.push(new TextRun({ text: transform(item), bold }));
  });

  return out;
}

const tableBorders = {
  top: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
  left: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
  right: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
  insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "000000" },
};

function createAcreenciasTable(acreencias: AcreenciaRow[]) {
  const headers = ["ACREEDOR", "NATURALEZA", "PRELACION", "CAPITAL", "INT. CTE.", "INT. MORA", "OTROS COBROS/ SEGUROS", "TOTAL", "%"];
  const columnWidths = [18, 10, 8, 11, 9, 9, 14, 13, 8];
  const tableWidthTwip = convertInchesToTwip(11 - (0.6 * 2) - 1.75); // 11" page - margins - a bit of slack
  const columnWidthsTwip = columnWidths.map((pct) => Math.max(120, Math.round((tableWidthTwip * pct) / 100)));
  const twipSum = columnWidthsTwip.reduce((acc, v) => acc + v, 0);
  if (columnWidthsTwip.length > 0 && twipSum !== tableWidthTwip) {
    columnWidthsTwip[columnWidthsTwip.length - 1] += tableWidthTwip - twipSum;
  }

  // Calculate totals
  let totalCapital = 0;
  let totalIntCte = 0;
  let totalIntMora = 0;
  let totalOtros = 0;
  let totalTotal = 0;

  acreencias.forEach((a) => {
    totalCapital += a.capital ?? 0;
    totalIntCte += a.int_cte ?? 0;
    totalIntMora += a.int_mora ?? 0;
    totalOtros += a.otros ?? 0;
    totalTotal += a.total ?? 0;
  });

  const headerRow = new TableRow({
    children: headers.map(
      (header) =>
        new TableCell({
          children: [new Paragraph({
            children: [new TextRun({ text: header, bold: true, size: 18 })],
            alignment: AlignmentType.CENTER,
          })],
          borders: tableBorders,
          shading: { fill: "E0E0E0" },
        })
    ),
  });

  const bodyRows = acreencias.map(
    (a) =>
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: a.acreedor?.trim() || "—", size: 18 })] })],
            borders: tableBorders,
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: a.naturaleza?.trim() || "—", size: 18 })] })],
            borders: tableBorders,
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: a.prelacion?.trim() || "—", size: 18 })], alignment: AlignmentType.CENTER })],
            borders: tableBorders,
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: formatCurrency(a.capital), size: 18 })], alignment: AlignmentType.RIGHT })],
            borders: tableBorders,
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: formatCurrency(a.int_cte), size: 18 })], alignment: AlignmentType.RIGHT })],
            borders: tableBorders,
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: formatCurrency(a.int_mora), size: 18 })], alignment: AlignmentType.RIGHT })],
            borders: tableBorders,
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: formatCurrency(a.otros), size: 18 })], alignment: AlignmentType.RIGHT })],
            borders: tableBorders,
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: formatCurrency(a.total), size: 18 })], alignment: AlignmentType.RIGHT })],
            borders: tableBorders,
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: formatPercentage(a.porcentaje), size: 18 })], alignment: AlignmentType.RIGHT })],
            borders: tableBorders,
          }),
        ],
      })
  );

  // Totals row
  const totalsRow = new TableRow({
    children: [
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: "TOTALES", bold: true, size: 18 })] })],
        borders: tableBorders,
        shading: { fill: "E0E0E0" },
      }),
      new TableCell({ children: [new Paragraph("")], borders: tableBorders, shading: { fill: "E0E0E0" } }),
      new TableCell({ children: [new Paragraph("")], borders: tableBorders, shading: { fill: "E0E0E0" } }),
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: formatCurrency(totalCapital), bold: true, size: 18 })], alignment: AlignmentType.RIGHT })],
        borders: tableBorders,
        shading: { fill: "E0E0E0" },
      }),
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: formatCurrency(totalIntCte), bold: true, size: 18 })], alignment: AlignmentType.RIGHT })],
        borders: tableBorders,
        shading: { fill: "E0E0E0" },
      }),
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: formatCurrency(totalIntMora), bold: true, size: 18 })], alignment: AlignmentType.RIGHT })],
        borders: tableBorders,
        shading: { fill: "E0E0E0" },
      }),
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: formatCurrency(totalOtros), bold: true, size: 18 })], alignment: AlignmentType.RIGHT })],
        borders: tableBorders,
        shading: { fill: "E0E0E0" },
      }),
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: formatCurrency(totalTotal), bold: true, size: 18 })], alignment: AlignmentType.RIGHT })],
        borders: tableBorders,
        shading: { fill: "E0E0E0" },
      }),
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: "100,00%", bold: true, size: 18 })], alignment: AlignmentType.RIGHT })],
        borders: tableBorders,
        shading: { fill: "E0E0E0" },
      }),
    ],
  });

  return new Table({
    rows: [headerRow, ...bodyRows, totalsRow],
    width: { size: tableWidthTwip, type: WidthType.DXA },
    columnWidths: columnWidthsTwip,
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
    layout: TableLayoutType.FIXED,
    alignment: AlignmentType.CENTER,
  });
}

function buildAsistentesParagraphs(asistentes: Asistente[], deudorNombre?: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  // Filter only present attendees (Presentes)
  const presentes = asistentes.filter((a) => a.estado === "Presente");

  presentes.forEach((asistente) => {
    const parts: TextRun[] = [];

    if (asistente.categoria === "Apoderado") {
      // Format: NAME, ciudadano mayor de edad, e identificado con cedula de ciudadanía número X,
      // portador de la tarjeta profesional No. X del CSJ, con correo electrónico X,
      // en calidad de apoderado de [DEUDOR/ACREEDOR]
      parts.push(new TextRun({ text: asistente.nombre.toUpperCase(), bold: true }));
      parts.push(new TextRun({ text: ", ciudadana mayor de edad, e identificada con cedula de ciudadanía número " }));
      parts.push(new TextRun({ text: asistente.identificacion || "[IDENTIFICACIÓN]" }));

      if (asistente.tarjetaProfesional) {
        parts.push(new TextRun({ text: ", portadora de la tarjeta profesional No. " }));
        parts.push(new TextRun({ text: asistente.tarjetaProfesional }));
        parts.push(new TextRun({ text: " del CSJ" }));
      }

      if (asistente.email) {
        parts.push(new TextRun({ text: ", con correo electrónico " }));
        parts.push(new TextRun({ text: asistente.email }));
      }

      if (asistente.calidadApoderadoDe) {
        parts.push(new TextRun({ text: ", en calidad de apoderada de " }));
        parts.push(new TextRun({ text: asistente.calidadApoderadoDe }));
      } else if (deudorNombre) {
        parts.push(new TextRun({ text: ", en calidad de apoderada del deudor insolvente el señor " }));
        parts.push(new TextRun({ text: deudorNombre.toUpperCase() }));
      }
      parts.push(new TextRun({ text: "." }));
    } else if (asistente.categoria === "Acreedor") {
      // Entity format with NIT
      if (asistente.nit) {
        parts.push(new TextRun({ text: asistente.nombre.toUpperCase(), bold: true }));
        parts.push(new TextRun({ text: ", identificado con el Nit No. " }));
        parts.push(new TextRun({ text: asistente.nit }));
        parts.push(new TextRun({ text: "." }));
      } else {
        parts.push(new TextRun({ text: asistente.nombre.toUpperCase(), bold: true }));
        if (asistente.identificacion) {
          parts.push(new TextRun({ text: ", identificado con cédula de ciudadanía No. " }));
          parts.push(new TextRun({ text: asistente.identificacion }));
        }
        parts.push(new TextRun({ text: "." }));
      }
    }

    if (parts.length > 0) {
      paragraphs.push(new Paragraph({
        children: parts,
        spacing: { after: 200 },
        indent: { left: convertInchesToTwip(0.5) },
      }));
    }
  });

  return paragraphs;
}

async function buildDocx(payload: TerminarAudienciaPayload, eventoContext: EventoContext | null) {
  const ciudad = payload.ciudad || "Cali";
  const horaActa = resolveHoraActa(eventoContext?.horaHHMM ?? payload.hora);
  const dateParts = formatDateParts(payload.fecha);
  const deudorNombre = payload.deudor?.nombre?.trim() || "[NOMBRE DEL DEUDOR]";
  const deudorId =
    payload.deudor?.identificacion != null && String(payload.deudor.identificacion).trim()
      ? String(payload.deudor.identificacion).trim()
      : "[IDENTIFICACIÓN]";

  let operadorNombre = payload.operador?.nombre || "JOSE ALEJANDRO PARDO MARTINEZ";
  const operadorId = payload.operador?.identificacion || "1.154.967.376";
  const operadorTp = payload.operador?.tarjetaProfesional || "429.496";
  let operadorEmail = payload.operador?.email || "fundaseer@gmail.com";

  // If the request came from an evento, the operador is the event owner (eventos.usuario_id).
  if (eventoContext?.usuario?.nombre) operadorNombre = eventoContext.usuario.nombre;
  if (eventoContext?.usuario?.email) operadorEmail = eventoContext.usuario.email;

  const proximaFecha = payload.proximaAudiencia?.fecha
    ? formatDateLong(payload.proximaAudiencia.fecha)
    : "[FECHA PRÓXIMA AUDIENCIA]";
  const proximaHora = payload.proximaAudiencia?.hora || "9:30 AM";

  const portraitBefore: (Paragraph | Table)[] = [];
  const landscapeAcreencias: (Paragraph | Table)[] = [];
  const portraitAfter: (Paragraph | Table)[] = [];
  let sections = portraitBefore;

  if (payload.debug) {
    sections.push(new Paragraph({
      children: [
        new TextRun({ text: "DEBUG ", bold: true }),
        new TextRun({
          text: `generatedAt=${new Date().toISOString()} procesoId=${payload.procesoId} deudor=${deudorNombre} cc=${deudorId}`,
        }),
      ],
      spacing: { after: 200 },
    }));
  }

  // Title
  sections.push(new Paragraph({
    children: [new TextRun({ text: "ACTA SUSPENSIÓN", bold: true, size: 28 })],
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
  }));

  sections.push(new Paragraph({
    children: [new TextRun({ text: "SUSPENSION DE AUDIENCIA NEGOCIACION DE DEUDAS", bold: true, size: 24 })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 60 },
  }));

  sections.push(new Paragraph({
    children: [new TextRun({ text: "INSOLVENCIA DE PERSONA NATURAL NO COMERCIANTE", bold: true, size: 24 })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 300 },
  }));

  // Deudor info
  sections.push(new Paragraph({
    children: [
      new TextRun({ text: "DEUDOR:\t", bold: true }),
      new TextRun({ text: deudorNombre.toUpperCase() }),
    ],
    spacing: { after: 60 },
  }));

  sections.push(new Paragraph({
    children: [
      new TextRun({ text: "C.C.\t\t", bold: true }),
      new TextRun({ text: deudorId }),
    ],
    spacing: { after: 200 },
  }));

  // Date
  sections.push(new Paragraph({
    children: [
      new TextRun({ text: "FECHA DE AUDIENCIA: ", bold: true }),
      new TextRun({ text: formatDateLong(payload.fecha) }),
    ],
    spacing: { after: 300 },
  }));

  // Introduction paragraph
  sections.push(new Paragraph({
    children: [
      new TextRun({ text: `En ${ciudad}, a los ${dateParts.day} días del mes de ${dateParts.month} de ${dateParts.year}, siendo las ${horaActa.fullLower}, se reunieron en Audiencia en el Centro de Conciliación Fundaseer, las siguientes personas:` }),
    ],
    spacing: { after: 300 },
  }));

  // First: Apoderado del Deudor (if present)
  // Priority: look for apoderado explicitly marked as "deudor", otherwise take first present apoderado not marked as "acreedor"
  console.log("[buildDocx] === ASISTENTES DEBUG ===");
  console.log("[buildDocx] Total asistentes:", payload.asistentes.length);
  payload.asistentes.forEach((a, i) => {
    console.log(`[buildDocx] Asistente ${i}:`, {
      nombre: a.nombre,
      categoria: a.categoria,
      estado: a.estado,
      calidadApoderadoDe: a.calidadApoderadoDe,
    });
  });

  // 1. First priority: Apoderado marked explicitly for "deudor"
  // 2. Second priority: Apoderado NOT marked for "acreedor"
  // 3. Final fallback: Any present Apoderado
  const apoderadoDeudor = payload.asistentes.find(
    (a) => a.categoria === "Apoderado" &&
           a.estado === "Presente" &&
           a.calidadApoderadoDe?.toLowerCase()?.includes("deudor")
  ) || payload.asistentes.find(
    (a) => a.categoria === "Apoderado" &&
           a.estado === "Presente" &&
           !a.calidadApoderadoDe?.toLowerCase()?.includes("acreedor")
  ) || payload.asistentes.find(
    (a) => a.categoria === "Apoderado" && a.estado === "Presente"
  );

  console.log("[buildDocx] apoderadoDeudor found:", apoderadoDeudor ? apoderadoDeudor.nombre : "NONE");
  if (!apoderadoDeudor) {
    const apoderados = payload.asistentes.filter((a) => a.categoria === "Apoderado");
    console.log("[buildDocx] WARNING: No apoderado found. Apoderados in list:", apoderados.length);
    apoderados.forEach((a) => console.log(`  - ${a.nombre}: estado=${a.estado}, calidadDe=${a.calidadApoderadoDe}`));
  }

  if (apoderadoDeudor) {
    const partsApoderadoDeudor: TextRun[] = [];
    partsApoderadoDeudor.push(new TextRun({ text: apoderadoDeudor.nombre.toUpperCase(), bold: true }));
    partsApoderadoDeudor.push(new TextRun({ text: ", ciudadana mayor de edad, e identificada con cedula de ciudadanía número " }));
    partsApoderadoDeudor.push(new TextRun({ text: apoderadoDeudor.identificacion || "[IDENTIFICACIÓN]" }));

    if (apoderadoDeudor.tarjetaProfesional) {
      partsApoderadoDeudor.push(new TextRun({ text: ", portadora de la tarjeta profesional No. " }));
      partsApoderadoDeudor.push(new TextRun({ text: apoderadoDeudor.tarjetaProfesional }));
      partsApoderadoDeudor.push(new TextRun({ text: " del CSJ" }));
    }

    if (apoderadoDeudor.email) {
      partsApoderadoDeudor.push(new TextRun({ text: ", con correo electrónico " }));
      partsApoderadoDeudor.push(new TextRun({ text: apoderadoDeudor.email }));
    }

    partsApoderadoDeudor.push(new TextRun({ text: ", en calidad de apoderada del deudor insolvente el señor " }));
    partsApoderadoDeudor.push(new TextRun({ text: deudorNombre.toUpperCase(), bold: true }));
    partsApoderadoDeudor.push(new TextRun({ text: "." }));

    sections.push(new Paragraph({
      children: partsApoderadoDeudor,
      spacing: { after: 200 },
      indent: { left: convertInchesToTwip(0.5) },
    }));
  }

  // Other Attendees (Acreedores and their apoderados)
  const otrosAsistentes = payload.asistentes.filter(
    (a) => a.estado === "Presente" && a !== apoderadoDeudor
  );
  const asistentesParagraphs = buildAsistentesParagraphs(otrosAsistentes, deudorNombre);
  sections.push(...asistentesParagraphs);

  // OBJETO DE LA AUDIENCIA
  sections.push(new Paragraph({
    children: [new TextRun({ text: "OBJETO DE LA AUDIENCIA", bold: true, size: 24 })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 200 },
  }));

  sections.push(new Paragraph({
    children: [
      new TextRun({
        text: "Conforme al título IV la ley 1564 de 2012 se adelanta la presente audiencia de Conciliación dentro del trámite de insolvencia de persona natural no comerciante solicitada por el señor ",
      }),
      new TextRun({ text: deudorNombre.toUpperCase(), bold: true }),
      new TextRun({ text: " en calidad de insolvente." }),
    ],
    spacing: { after: 300 },
  }));

  // RESULTADO DE LA DILIGENCIA
  sections.push(new Paragraph({
    children: [new TextRun({ text: "RESULTADO DE LA DILIGENCIA", bold: true, size: 24 })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 200 },
  }));

  const resultadoCustom = payload.resultadoDiligencia?.trim();

  if (resultadoCustom) {
    sections.push(new Paragraph({
      children: [new TextRun({ text: resultadoCustom })],
      spacing: { after: 300 },
    }));
  } else {
    sections.push(new Paragraph({
      children: [
        new TextRun({
          text: `Siendo las ${horaActa.fullUpper} el conciliador designado, le da inicio a la diligencia programada para el día de Hoy, verificando la asistencia de las partes, `,
        }),
        new TextRun({ text: "INSOLVENTE", bold: true }),
        new TextRun({ text: ", y " }),
        new TextRun({ text: "ACREEDORES", bold: true }),
        new TextRun({ text: "." }),
      ],
      spacing: { after: 200 },
    }));

    sections.push(new Paragraph({
      children: [
        new TextRun({
          text: "Siguiendo los parámetros del artículo 550 del Código General del Proceso (Desarrollo de la audiencia de Negociación de Deudas 1.- El conciliador pondrá en conocimiento de los acreedores la relación detallada de las acreencias y les preguntará si están de acuerdo con la existencia, naturaleza y cuantía de las obligaciones relacionadas por parte del deudor y si tienen dudas o discrepancias con relación a las propias o respecto de otras acreencias.",
        }),
      ],
      spacing: { after: 300 },
    }));
  }

  // GRADUACION Y CALIFICACION PROVISIONAL DE CREDITOS
  if (payload.acreencias.length > 0) {
    sections = landscapeAcreencias;
  }

  sections.push(new Paragraph({
    children: [new TextRun({ text: "GRADUACION Y CALIFICACION PROVISIONAL DE CREDITOS", bold: true, size: 24 })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 200 },
  }));

  if (payload.acreencias.length > 0) {
    sections.push(createAcreenciasTable(payload.acreencias));

    const acreedores = payload.acreencias
      .map((a) => a.acreedor?.trim() ?? "")
      .filter(Boolean);
    const uniqueAcreedores = [...new Set(acreedores)];

    sections.push(new Paragraph({
      children: [
        new TextRun({ text: "Se encuentra graduado y calificado de manera provisional " }),
        ...(uniqueAcreedores.length > 0
          ? formatListRunsWithY(uniqueAcreedores, { bold: true, transform: (s) => s.toUpperCase() })
          : [new TextRun({ text: "[ACREEDORES]" })]
        ),
        new TextRun({ text: "." }),
      ],
      spacing: { before: 200, after: 200 },
    }));

    sections = portraitAfter;
  }

  const observaciones = payload.observacionesFinales ||
    `Se deja constancia de que la apoderada del deudor procedió a verbalizar la propuesta de pago, frente a lo cual los acreedores asistentes expusieron las políticas aplicables de cada una de sus entidades. En razón de lo anterior, la apoderada del deudor solicitó la suspensión de la presente diligencia, con el fin de informar a su representado las observaciones efectuadas a la propuesta y evaluar la posibilidad de modificarla. En caso de realizarse ajustes, la nueva propuesta actualizada deberá ser remitida a este centro de conciliación, con copia a todos los acreedores. Finalmente se deja constancia de que se encuentra precluida la etapa de relación de acreencias.`;

  sections.push(new Paragraph({
    children: [new TextRun({ text: observaciones })],
    spacing: { after: 200 },
  }));

  sections.push(new Paragraph({
    children: [
      new TextRun({ text: `Teniendo en cuenta lo anterior y que no se han presentes los demás acreedores. El suscrito conciliador informa que se hace necesario suspender la presente audiencia. Fijando nueva fecha para el día ` }),
      new TextRun({ text: proximaFecha, bold: true }),
      new TextRun({ text: ` a las ` }),
      new TextRun({ text: proximaHora, bold: true }),
      new TextRun({ text: `.` }),
    ],
    spacing: { after: 400 },
  }));

  // Signature
  sections.push(new Paragraph({
    children: [new TextRun({ text: "Atentamente," })],
    spacing: { before: 300, after: 400 },
  }));

  sections.push(new Paragraph({
    children: [new TextRun({ text: "\n\n\n\n" })],
  }));

  sections.push(new Paragraph({
    children: [new TextRun({ text: operadorNombre.toUpperCase(), bold: true })],
    alignment: AlignmentType.LEFT,
  }));

  sections.push(new Paragraph({
    children: [new TextRun({ text: `Conciliador Extrajudicial en Derecho y Operador en Insolvencias C. C. No. ${operadorId}` })],
  }));

  sections.push(new Paragraph({
    children: [new TextRun({ text: `T. P. No. ${operadorTp} del C S de la J.` })],
  }));

  sections.push(new Paragraph({
    children: [new TextRun({ text: `Email: ${operadorEmail}` })],
    spacing: { after: 200 },
  }));

  const portraitPage = {
    margin: {
      top: convertInchesToTwip(0.6),
      right: convertInchesToTwip(0.6),
      bottom: convertInchesToTwip(0.6),
      left: convertInchesToTwip(0.6),
    },
    size: {
      width: convertInchesToTwip(8.5),
      height: convertInchesToTwip(11),
      orientation: PageOrientation.PORTRAIT,
    },
  };

  const landscapePage = {
    margin: {
      top: convertInchesToTwip(0.6),
      right: convertInchesToTwip(0.6),
      bottom: convertInchesToTwip(0.6),
      left: convertInchesToTwip(0.6),
    },
    size: {
      width: convertInchesToTwip(11),
      height: convertInchesToTwip(8.5),
      orientation: PageOrientation.LANDSCAPE,
    },
  };

  const docSections: { properties: Record<string, unknown>; children: (Paragraph | Table)[] }[] = [];
  docSections.push({ properties: { page: portraitPage }, children: portraitBefore });
  if (landscapeAcreencias.length > 0) {
    docSections.push({ properties: { page: landscapePage }, children: landscapeAcreencias });
  }
  if (portraitAfter.length > 0) {
    docSections.push({ properties: { page: portraitPage }, children: portraitAfter });
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: {
              ascii: "Century Gothic",
              hAnsi: "Century Gothic",
              cs: "Century Gothic",
              eastAsia: "Century Gothic",
            },
          },
        },
      },
    },
    sections: docSections,
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

    // Always log deudor data for debugging
    console.log("[terminar-audiencia] ===== DEUDOR DATA RECEIVED =====");
    console.log("[terminar-audiencia] payload.deudor:", JSON.stringify(payload.deudor, null, 2));
    console.log("[terminar-audiencia] deudor.nombre:", payload.deudor?.nombre ?? "NOT PROVIDED");
    console.log("[terminar-audiencia] deudor.identificacion:", payload.deudor?.identificacion ?? "NOT PROVIDED");
    console.log("[terminar-audiencia] ================================");

    const safeTitle = (payload.titulo || "audiencia")
      .trim()
      .replace(/[^\p{L}\p{N}\s._-]+/gu, "")
      .replace(/\s+/g, " ")
      .slice(0, 80);

    const fileName = `${payload.numeroProceso?.trim() || payload.procesoId} - ${payload.fecha} - ${
      safeTitle || "Acta Suspensión"
    }.docx`;

    const eventoContext = await loadEventoUsuario({
      eventoId: payload.eventoId ?? null,
      procesoId: payload.procesoId,
      fecha: payload.fecha,
      hora: payload.hora ?? null,
    });

    const buffer = await buildDocx(payload, eventoContext);

    const uploaded = await uploadDocxToGoogleDrive({
      filename: fileName,
      buffer,
      folderId: process.env.GOOGLE_DRIVE_FOLDER_ID ?? null,
      shareWithEmails: eventoContext?.usuario?.email
        ? [eventoContext.usuario.email]
        : payload.operador?.email
          ? [payload.operador.email]
          : null,
    });

    // Collect apoderado emails for potential later use
    const apoderadoEmails = payload.asistentes
      .filter((a) => a.categoria === "Apoderado" && isValidEmail(a.email))
      .map((a) => a.email!.trim().toLowerCase());
    const uniqueEmails = [...new Set(apoderadoEmails)];

    return NextResponse.json({
      fileId: uploaded.id,
      fileName: uploaded.name,
      webViewLink: uploaded.webViewLink ?? null,
      webContentLink: uploaded.webContentLink ?? null,
      apoderadoEmails: uniqueEmails,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "Failed to terminar audiencia.", detail: toErrorMessage(e) },
      { status: 500 }
    );
  }
}
