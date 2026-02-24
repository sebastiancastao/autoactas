import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { JWT } from "google-auth-library";
import {
  AlignmentType,
  Document,
  Header,
  HeadingLevel,
  ImageRun,
  type ISectionOptions,
  type ISectionPropertiesOptions,
  Packer,
  Paragraph,
  PageOrientation,
  Tab,
  TabStopType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun as DocxTextRun,
  WidthType,
  BorderStyle,
  convertInchesToTwip,
} from "docx";
import { promises as fs } from "fs";
import path from "path";
import * as XLSX from "xlsx";

import { uploadDocxToGoogleDrive } from "@/lib/google-drive";
import type { Database } from "@/lib/database.types";

export const runtime = "nodejs";

type UsuarioEvento = Pick<
  Database["public"]["Tables"]["usuarios"]["Row"],
  "id" | "nombre" | "email" | "identificacion" | "firma_data_url"
>;
type EventoContext = { usuario: UsuarioEvento | null; horaHHMM: string | null };

type TextRunCtorArg = ConstructorParameters<typeof DocxTextRun>[0];

const cp1252ToLatin1Map: Record<string, string> = {
  "€": "\x80",
  "‚": "\x82",
  "ƒ": "\x83",
  "„": "\x84",
  "…": "\x85",
  "†": "\x86",
  "‡": "\x87",
  "ˆ": "\x88",
  "‰": "\x89",
  "Š": "\x8A",
  "‹": "\x8B",
  "Œ": "\x8C",
  "Ž": "\x8E",
  "‘": "\x91",
  "’": "\x92",
  "“": "\x93",
  "”": "\x94",
  "•": "\x95",
  "–": "\x96",
  "—": "\x97",
  "˜": "\x98",
  "™": "\x99",
  "š": "\x9A",
  "›": "\x9B",
  "œ": "\x9C",
  "ž": "\x9E",
  "Ÿ": "\x9F",
};

function cp1252ToLatin1(value: string) {
  return value.replace(/[€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]/g, (ch) => cp1252ToLatin1Map[ch] ?? ch);
}

function normalizeMojibakeText(value: string) {
  if (!/[ÃÂâ]/.test(value)) return value;
  let current = value;
  for (let i = 0; i < 3; i += 1) {
    const decoded = Buffer.from(cp1252ToLatin1(current), "latin1").toString("utf8");
    if (!decoded || decoded === current) break;
    current = decoded;
    if (!/[ÃÂâ]/.test(current)) break;
  }
  return current;
}

function hasTextField(value: unknown): value is { text: unknown } {
  return typeof value === "object" && value !== null && "text" in value;
}

class TextRun extends DocxTextRun {
  constructor(options?: TextRunCtorArg) {
    if (options === undefined) {
      super("");
      return;
    }
    if (typeof options === "string") {
      super(normalizeMojibakeText(options));
      return;
    }
    if (hasTextField(options) && typeof options.text === "string") {
      super({ ...options, text: normalizeMojibakeText(options.text) } as TextRunCtorArg);
      return;
    }
    super(options);
  }
}

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
  voto?: string | null;
  dias_mora?: number | null;
};

type TerminarAudienciaPayload = {
  procesoId: string;
  numeroProceso?: string | null;
  titulo: string;
  fecha: string; // YYYY-MM-DD
  eventoId?: string | null;
  hora?: string; // HH:MM
  ciudad?: string;
  tipoDocumento?: string;
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
  propuestaPago?: {
    primera_clase?: {
      numero_cuotas?: string;
      interes_reconocido?: string;
      inicio_pagos?: string;
      fecha_fin_pagos?: string;
    };
    tercera_clase?: {
      numero_cuotas?: string;
      interes_reconocido?: string;
      inicio_pagos?: string;
      fecha_fin_pagos?: string;
    };
    quinta_clase?: {
      numero_cuotas?: string;
      interes_reconocido?: string;
      inicio_pagos?: string;
      fecha_fin_pagos?: string;
    };
  };
  excelArchivo?: ProcesoExcelArchivoRow;
};

type ProcesoExcelArchivoRow = Pick<
  Database["public"]["Tables"]["proceso_excel_archivos"]["Row"],
  | "id"
  | "proceso_id"
  | "original_file_name"
  | "drive_file_id"
  | "drive_file_name"
  | "drive_web_view_link"
  | "drive_web_content_link"
  | "created_at"
>;

type ExcelDocTable = {
  title: string;
  headers: string[];
  rows: string[][];
  metadata?: Array<{ label: string; value: string }>;
};

type ExcelDocData = {
  source: ProcesoExcelArchivoRow;
  projectionTables: ExcelDocTable[];
  votingTable: ExcelDocTable | null;
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
      "[terminar-audiencia] Unable to load header image fundaseer.png:",
      error instanceof Error ? error.message : String(error)
    );
  }

  try {
    rightLogo = await fs.readFile(rightPath);
  } catch (error) {
    console.warn(
      "[terminar-audiencia] Unable to load header image ministeriodelderecho.png:",
      error instanceof Error ? error.message : String(error)
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
        // Shift both logos right in a way Google Docs preserves.
        indent: { left: convertInchesToTwip(0.85) },
        tabStops: [
          {
            type: TabStopType.RIGHT,
            position: convertInchesToTwip(8.35),
          },
        ],
        children: [
          leftLogoRun!,
          new Tab(),
          rightLogoRun!,
        ],
      }),
    ],
  });
}

function buildSection(
  page: NonNullable<ISectionPropertiesOptions["page"]>,
  header: Header | null,
  children: Array<Paragraph | Table>
): ISectionOptions {
  return header
    ? { properties: { page }, headers: { default: header }, children }
    : { properties: { page }, children };
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
  return trimmed;
}

function parsePrivateKey(raw: string) {
  return raw.replace(/\\n/g, "\n");
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

async function downloadDriveFileBuffer(fileId: string) {
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

function normalizeMatchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function parseMaybeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized = raw
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".")
    .replace(/[^0-9.-]/g, "");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

function sanitizeCellText(value: unknown) {
  const text = String(value ?? "").trim();
  return text || "—";
}

function formatExcelMoneyValue(value: unknown) {
  const num = parseMaybeNumber(value);
  if (num !== null) return formatCurrency(num);
  return sanitizeCellText(value);
}

function getSheetCellValue(sheet: XLSX.WorkSheet, row1: number, col1: number) {
  const address = XLSX.utils.encode_cell({ r: row1 - 1, c: col1 - 1 });
  const cell = sheet[address];
  if (!cell) return "";
  if (cell.w !== undefined && cell.w !== null && String(cell.w).trim() !== "") return cell.w;
  if (cell.v !== undefined && cell.v !== null) return cell.v;
  return "";
}

const projectionMetadataDefinitions: Array<{ label: string; aliases: string[] }> = [
  { label: "ENTIDAD", aliases: ["ENTIDAD", "ACREEDOR"] },
  { label: "CAPITAL INICIAL", aliases: ["CAPITAL INICIAL", "VALOR DEL CREDITO", "VALOR CREDITO"] },
  { label: "PLAZO DEL CREDITO", aliases: ["PLAZO DEL CREDITO", "PLAZO CREDITO", "TIEMPO MESES"] },
  { label: "INTERES MENSUAL", aliases: ["INTERES MENSUAL", "TASA MENSUAL"] },
  { label: "INTERES ANUAL", aliases: ["INTERES ANUAL", "TASA ANUAL"] },
  { label: "TOTAL DE CUOTAS", aliases: ["TOTAL DE CUOTAS", "NUMERO DE CUOTAS", "NO CUOTAS"] },
  { label: "VALOR DE LA CUOTA", aliases: ["VALOR DE LA CUOTA", "CUOTA FIJA"] },
];

function isProjectionMetadataLabel(text: string) {
  const norm = normalizeMatchText(text);
  if (!norm) return false;
  return projectionMetadataDefinitions.some((def) =>
    def.aliases.some((alias) => norm === alias || norm.includes(alias))
  );
}

function extractProjectionMetadataFromSheet(sheet: XLSX.WorkSheet, sheetName: string) {
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  }) as unknown[][];

  const found = new Map<string, string>();
  const maxRows = Math.min(matrix.length, 45);

  const resolveValue = (rowIndex: number, colIndex: number) => {
    const row = matrix[rowIndex] ?? [];
    for (let c = colIndex + 1; c < Math.min(row.length, colIndex + 9); c += 1) {
      const candidate = String(row[c] ?? "").trim();
      if (!candidate || isProjectionMetadataLabel(candidate)) continue;
      return candidate;
    }

    for (let r = rowIndex + 1; r <= Math.min(maxRows - 1, rowIndex + 4); r += 1) {
      const nextRow = matrix[r] ?? [];
      const sameCol = String(nextRow[colIndex] ?? "").trim();
      if (sameCol && !isProjectionMetadataLabel(sameCol)) return sameCol;
      for (let c = 0; c < Math.min(nextRow.length, 12); c += 1) {
        const candidate = String(nextRow[c] ?? "").trim();
        if (!candidate || isProjectionMetadataLabel(candidate)) continue;
        return candidate;
      }
    }

    return "";
  };

  for (let r = 0; r < maxRows; r += 1) {
    const row = matrix[r] ?? [];
    for (let c = 0; c < Math.min(row.length, 12); c += 1) {
      const raw = String(row[c] ?? "").trim();
      if (!raw) continue;
      const norm = normalizeMatchText(raw);
      if (!norm) continue;

      projectionMetadataDefinitions.forEach((def) => {
        if (found.has(def.label)) return;
        const matches = def.aliases.some((alias) => norm === alias || norm.includes(alias));
        if (!matches) return;
        const value = resolveValue(r, c);
        if (value) found.set(def.label, value);
      });
    }
  }

  if (!found.has("ENTIDAD")) {
    found.set("ENTIDAD", sheetName);
  }

  const capitalInicial = String(getSheetCellValue(sheet, 5, 9) ?? "").trim();
  if (!found.has("CAPITAL INICIAL") && capitalInicial) {
    found.set("CAPITAL INICIAL", capitalInicial);
  }

  const interesMensual = String(getSheetCellValue(sheet, 6, 9) ?? "").trim();
  if (!found.has("INTERES MENSUAL") && interesMensual) {
    found.set("INTERES MENSUAL", interesMensual);
  }

  const plazoCredito = String(getSheetCellValue(sheet, 7, 9) ?? "").trim();
  if (!found.has("PLAZO DEL CREDITO") && plazoCredito) {
    found.set("PLAZO DEL CREDITO", plazoCredito);
  }
  if (!found.has("TOTAL DE CUOTAS") && plazoCredito) {
    found.set("TOTAL DE CUOTAS", plazoCredito);
  }

  const valorCuotaActual = String(found.get("VALOR DE LA CUOTA") ?? "").trim();
  const valorCuotaNormalizado = normalizeMatchText(valorCuotaActual);
  const valorCuotaInvalido =
    !valorCuotaActual ||
    valorCuotaNormalizado.includes("VALOR TOTAL ACUMULADO") ||
    valorCuotaNormalizado.includes("TABLA DE AMORTIZACION");
  if (valorCuotaInvalido) {
    for (let row1 = 19; row1 <= 60; row1 += 1) {
      const cuota = parseMaybeNumber(getSheetCellValue(sheet, row1, 5));
      if (cuota === null || cuota <= 0) continue;
      const cuotaValue = String(getSheetCellValue(sheet, row1, 17) ?? "").trim();
      if (cuotaValue) {
        found.set("VALOR DE LA CUOTA", cuotaValue);
        break;
      }
    }
  }

  const orderedLabels = projectionMetadataDefinitions.map((def) => def.label);
  return orderedLabels
    .map((label) => {
      const value = found.get(label);
      if (!value) return null;
      return { label, value: sanitizeCellText(value) };
    })
    .filter((entry): entry is { label: string; value: string } => Boolean(entry));
}

function extractProjectionTableByHeaders(
  sheet: XLSX.WorkSheet
): Pick<ExcelDocTable, "headers" | "rows"> | null {
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  }) as unknown[][];
  if (matrix.length === 0) return null;

  let headerRowIndex = -1;
  let selectedColumns: number[] = [];

  for (let r = 0; r < matrix.length; r += 1) {
    const row = matrix[r] ?? [];
    const nonEmptyColumns: number[] = [];
    row.forEach((cell, idx) => {
      if (String(cell ?? "").trim()) nonEmptyColumns.push(idx);
    });
    if (nonEmptyColumns.length < 3) continue;

    const normalizedCells = nonEmptyColumns.map((idx) => normalizeMatchText(String(row[idx] ?? "")));
    const hasCuota = normalizedCells.some((cell) => cell.includes("CUOTA"));
    const hasFecha = normalizedCells.some(
      (cell) => cell.includes("FECHA") || cell.includes("VENCIMIENTO")
    );
    const hasValor = normalizedCells.some((cell) => cell.includes("VALOR") || cell.includes("TOTAL"));
    const hasInteres = normalizedCells.some((cell) => cell.includes("INTERES"));
    const hasAmortizacion = normalizedCells.some((cell) => cell.includes("AMORT"));
    const hasSaldo = normalizedCells.some((cell) => cell.includes("SALDO"));

    const score = [hasCuota, hasFecha, hasValor, hasInteres, hasAmortizacion, hasSaldo].filter(Boolean).length;
    if (score < 3) continue;

    headerRowIndex = r;
    selectedColumns = nonEmptyColumns;
    break;
  }

  if (headerRowIndex < 0 || selectedColumns.length === 0) return null;

  const headerSource = matrix[headerRowIndex] ?? [];
  const headers = selectedColumns.map((idx) => sanitizeCellText(headerSource[idx]));
  const rows: string[][] = [];
  let blankStreak = 0;

  for (let r = headerRowIndex + 1; r < matrix.length; r += 1) {
    const sourceRow = matrix[r] ?? [];
    const hasAny = selectedColumns.some((idx) => String(sourceRow[idx] ?? "").trim());
    if (!hasAny) {
      blankStreak += 1;
      if (rows.length > 0 && blankStreak >= 10) break;
      continue;
    }
    blankStreak = 0;
    rows.push(selectedColumns.map((idx) => sanitizeCellText(sourceRow[idx])));
  }

  return rows.length > 0 ? { headers, rows } : null;
}

function extractProjectionTableByFixedColumns(
  sheet: XLSX.WorkSheet
): Pick<ExcelDocTable, "headers" | "rows"> | null {
  const headers = ["Cuota", "Vencimiento", "Saldo capital", "Abono capital", "Intereses", "Total cuota"];

  const ref = sheet["!ref"];
  if (!ref) return null;
  const range = XLSX.utils.decode_range(ref);
  const maxRow = range.e.r + 1;
  const term = Math.max(1, Math.trunc(parseMaybeNumber(getSheetCellValue(sheet, 7, 9)) ?? 120));
  const upperRow = Math.min(maxRow, 19 + term + 60);

  const rows: string[][] = [];
  let blankStreak = 0;
  for (let row1 = 18; row1 <= upperRow; row1 += 1) {
    const cuotaRaw = getSheetCellValue(sheet, row1, 5);
    const vencimientoDiaRaw = getSheetCellValue(sheet, row1, 6);
    const vencimientoMesRaw = getSheetCellValue(sheet, row1, 7);
    const vencimientoAnioRaw = getSheetCellValue(sheet, row1, 8);
    const saldoCapitalRaw = getSheetCellValue(sheet, row1, 9);
    const abonoCapitalRaw = getSheetCellValue(sheet, row1, 14);
    const interesesRaw = getSheetCellValue(sheet, row1, 16);
    const totalCuotaRaw = getSheetCellValue(sheet, row1, 17);

    const cuota = parseMaybeNumber(cuotaRaw);
    const vencimientoDia = sanitizeCellText(vencimientoDiaRaw);
    const vencimientoMes = sanitizeCellText(vencimientoMesRaw);
    const vencimientoAnio = sanitizeCellText(vencimientoAnioRaw);
    const hasAny =
      String(cuotaRaw ?? "").trim() ||
      String(vencimientoDiaRaw ?? "").trim() ||
      String(saldoCapitalRaw ?? "").trim() ||
      String(abonoCapitalRaw ?? "").trim() ||
      String(interesesRaw ?? "").trim() ||
      String(totalCuotaRaw ?? "").trim();

    if (!hasAny) {
      blankStreak += 1;
      if (rows.length > 0 && blankStreak >= 12) break;
      continue;
    }
    blankStreak = 0;

    if (cuota === null || cuota < 0) continue;

    rows.push([
      cuota === 0 ? "" : String(Math.trunc(cuota)),
      `${vencimientoDia} ${vencimientoMes} ${vencimientoAnio}`.trim(),
      formatExcelMoneyValue(saldoCapitalRaw),
      formatExcelMoneyValue(abonoCapitalRaw),
      formatExcelMoneyValue(interesesRaw),
      formatExcelMoneyValue(totalCuotaRaw),
    ]);

    if (rows.length >= term + 1) break;
  }

  return rows.length > 0 ? { headers, rows } : null;
}

function extractProjectionTablesFromWorkbook(workbook: XLSX.WorkBook) {
  const tables: ExcelDocTable[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const metadata = extractProjectionMetadataFromSheet(sheet, sheetName);
    const headerTable = extractProjectionTableByHeaders(sheet);
    const fixedTable = extractProjectionTableByFixedColumns(sheet);
    const selectedTable =
      headerTable && headerTable.headers.length >= 5 ? headerTable : fixedTable ?? headerTable;

    if (!selectedTable || selectedTable.rows.length === 0) continue;

    tables.push({
      title: `Proyeccion ${sheetName}`,
      headers: selectedTable.headers,
      rows: selectedTable.rows,
      metadata,
    });
  }

  return tables;
}
function extractVotingTableFromWorkbook(workbook: XLSX.WorkBook): ExcelDocTable | null {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    }) as unknown[][];
    if (matrix.length === 0) continue;

    let headerRowIndex = -1;
    let selectedColumns: number[] = [];

    for (let i = 0; i < matrix.length; i += 1) {
      const row = matrix[i] ?? [];
      const normalizedRow = row.map((cell) => normalizeMatchText(String(cell ?? "")));
      const hasVote = normalizedRow.some((cell) => cell.includes("VOTO") || cell.includes("VOTACION"));
      const hasCreditor = normalizedRow.some(
        (cell) => cell.includes("ACREEDOR") || cell.includes("APODERADO")
      );
      const hasPercent = normalizedRow.some(
        (cell) => cell === "%" || cell.includes("PORCENT")
      );
      if (!hasVote || !hasCreditor || !hasPercent) continue;

      const cols: number[] = [];
      row.forEach((cell, idx) => {
        if (String(cell ?? "").trim()) cols.push(idx);
      });
      if (cols.length < 3) continue;

      headerRowIndex = i;
      selectedColumns = cols;
      break;
    }

    if (headerRowIndex < 0 || selectedColumns.length === 0) continue;

    const headerSource = matrix[headerRowIndex] ?? [];
    const headers = selectedColumns.map((idx) => sanitizeCellText(headerSource[idx]));
    const rows: string[][] = [];
    let blankStreak = 0;
    for (let i = headerRowIndex + 1; i < matrix.length; i += 1) {
      const sourceRow = matrix[i] ?? [];
      const row = selectedColumns.map((idx) => sanitizeCellText(sourceRow[idx]));
      const hasAny = row.some((cell) => cell !== "—");
      if (!hasAny) {
        blankStreak += 1;
        if (rows.length > 0 && blankStreak >= 3) break;
        continue;
      }
      blankStreak = 0;
      rows.push(row);
    }

    if (rows.length > 0) {
      return {
        title: `VotaciÃ³n ${sheetName}`,
        headers,
        rows,
      };
    }
  }

  return null;
}

function filterProjectionTablesByAcreedores(
  tables: ExcelDocTable[],
  acreencias: AcreenciaRow[]
) {
  if (tables.length === 0 || acreencias.length === 0) return tables;

  const acreedorTokens = acreencias
    .map((a) => normalizeMatchText(String(a.acreedor ?? "")))
    .filter(Boolean)
    .flatMap((name) => name.split(" ").filter((token) => token.length >= 4));

  if (acreedorTokens.length === 0) return tables;

  const matched = tables.filter((table) => {
    const normTitle = normalizeMatchText(table.title);
    const compactTitle = normTitle.replace(/\s+/g, "");
    return acreedorTokens.some(
      (token) =>
        normTitle.includes(token) ||
        compactTitle.includes(token) ||
        token.includes(compactTitle)
    );
  });

  return matched.length > 0 ? matched : tables;
}

async function loadExcelDocData(
  procesoId: string,
  acreencias: AcreenciaRow[],
  excelArchivo?: ProcesoExcelArchivoRow,
  debug = false
): Promise<ExcelDocData | null> {
  const parseExcelFromSource = async (
    source: ProcesoExcelArchivoRow,
    sourceLabel: "payload" | "database"
  ): Promise<ExcelDocData> => {
    const fileBuffer = await downloadDriveFileBuffer(source.drive_file_id);
    const workbook = XLSX.read(fileBuffer, {
      type: "buffer",
      raw: false,
      cellFormula: false,
      cellDates: true,
    });
    const projectionTables = extractProjectionTablesFromWorkbook(workbook);
    const votingTable = extractVotingTableFromWorkbook(workbook);
    if (debug) {
      console.log("[terminar-audiencia] Excel parsed", {
        source: sourceLabel,
        driveFileId: source.drive_file_id,
        driveFileName: source.drive_file_name,
        projectionTables: projectionTables.length,
        projectionRows: projectionTables.reduce((acc, table) => acc + table.rows.length, 0),
        votingRows: votingTable?.rows.length ?? 0,
      });
    }

    return {
      source,
      projectionTables,
      votingTable,
    };
  };

  const payloadSource =
    excelArchivo?.proceso_id === procesoId && String(excelArchivo.drive_file_id ?? "").trim()
      ? excelArchivo
      : null;

  if (debug) {
    console.log("[terminar-audiencia] Excel payload source", {
      hasPayloadSource: Boolean(payloadSource),
      payloadProcesoId: excelArchivo?.proceso_id ?? null,
      payloadDriveFileId: excelArchivo?.drive_file_id ?? null,
    });
  }

  if (payloadSource) {
    try {
      return await parseExcelFromSource(payloadSource, "payload");
    } catch (err) {
      console.warn(
        "[terminar-audiencia] Unable to parse excel from payload source:",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  const supabase = createSupabaseAdmin();
  if (!supabase) {
    if (debug) {
      console.warn("[terminar-audiencia] Supabase admin client unavailable while loading excel.");
    }
    return null;
  }

  const { data, error } = await supabase
    .from("proceso_excel_archivos")
    .select(
      "id, proceso_id, original_file_name, drive_file_id, drive_file_name, drive_web_view_link, drive_web_content_link, created_at"
    )
    .eq("proceso_id", procesoId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn("[terminar-audiencia] Unable to load excel metadata:", error.message);
    return null;
  }
  if (!data) {
    if (debug) {
      console.warn("[terminar-audiencia] No excel metadata row found for proceso:", procesoId);
    }
    return null;
  }

  try {
    return await parseExcelFromSource(data as ProcesoExcelArchivoRow, "database");
  } catch (err) {
    console.warn(
      "[terminar-audiencia] Unable to parse excel from Drive:",
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
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
        .select("id, nombre, email, identificacion, firma_data_url")
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
    .select("id, nombre, email, identificacion, firma_data_url")
    .eq("id", usuarioId)
    .maybeSingle();

  if (userErr) {
    console.warn("[terminar-audiencia] Unable to load usuario:", userErr.message);
    return null;
  }

  return { usuario: (usuario ?? null) as UsuarioEvento | null, horaHHMM: eventoHora };
}

async function loadUsuarioFirmaDataUrlByEmail(email: string | null | undefined): Promise<string | null> {
  const normalizedEmail = String(email ?? "").trim().toLowerCase();
  if (!normalizedEmail) return null;

  const supabase = createSupabaseAdmin();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("usuarios")
    .select("firma_data_url")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (error) {
    console.warn("[terminar-audiencia] Unable to load usuario signature by email:", error.message);
    return null;
  }

  const firma = data?.firma_data_url;
  return typeof firma === "string" && firma.trim() ? firma : null;
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

function normalizeDateKey(value: string | null | undefined) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  // Expect YYYY-MM-DD (from <input type="date">). If not, keep raw.
  return v;
}

function parseCuotas(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const n = Number(raw.replace(/[^\d]/g, ""));
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function hasPropuestaPagoData(payload: TerminarAudienciaPayload) {
  type PropuestaClase = NonNullable<TerminarAudienciaPayload["propuestaPago"]>["primera_clase"];
  const p = payload.propuestaPago ?? {};
  const blocks: Array<keyof NonNullable<TerminarAudienciaPayload["propuestaPago"]>> = [
    "primera_clase",
    "tercera_clase",
    "quinta_clase",
  ];
  return blocks.some((key) => {
    const b = p[key] as PropuestaClase | undefined;
    if (!b) return false;
    return Boolean(
      String(b.numero_cuotas ?? "").trim() ||
      String(b.interes_reconocido ?? "").trim() ||
      String(b.inicio_pagos ?? "").trim() ||
      String(b.fecha_fin_pagos ?? "").trim()
    );
  });
}

function buildPropuestaPagoParagraphs(payload: TerminarAudienciaPayload): Paragraph[] {
  type PropuestaClase = NonNullable<TerminarAudienciaPayload["propuestaPago"]>["primera_clase"];
  const p = payload.propuestaPago ?? {};

  const blocks: Array<{
    key: keyof NonNullable<TerminarAudienciaPayload["propuestaPago"]>;
    title: string;
  }> = [
    { key: "primera_clase", title: "PAGO ACREEDOR DE PRIMERA CLASE:" },
    { key: "tercera_clase", title: "Pago a acreedor tercera clase:" },
    { key: "quinta_clase", title: "Pago a acreedores de quinta clase:" },
  ];

  const hasAny = blocks.some(({ key }) => {
    const b = p[key] as PropuestaClase | undefined;
    if (!b) return false;
    return Boolean(
      String(b.numero_cuotas ?? "").trim() ||
      String(b.interes_reconocido ?? "").trim() ||
      String(b.inicio_pagos ?? "").trim() ||
      String(b.fecha_fin_pagos ?? "").trim()
    );
  });

  if (!hasAny) {
    return [
      new Paragraph({
        children: [new TextRun({ text: "[PROPUESTA DE PAGO]" })],
        spacing: { after: 200 },
        indent: { left: convertInchesToTwip(0.5) },
      }),
    ];
  }

  const out: Paragraph[] = [];

  blocks.forEach(({ key, title }) => {
    const b = p[key] as PropuestaClase | undefined;
    if (!b) return;

    const cuotas = parseCuotas(b.numero_cuotas);
    const interes = String(b.interes_reconocido ?? "").trim();
    const inicioKey = normalizeDateKey(b.inicio_pagos);
    const finKey = normalizeDateKey(b.fecha_fin_pagos);

    const hasThis =
      cuotas !== null ||
      Boolean(interes) ||
      Boolean(inicioKey) ||
      Boolean(finKey);
    if (!hasThis) return;

    out.push(new Paragraph({
      children: [new TextRun({ text: title, bold: true })],
      spacing: { after: 120 },
    }));

    if (cuotas !== null) {
      const label = cuotas === 1 ? "1 cuota mensual" : `${cuotas} cuotas mensuales`;
      out.push(new Paragraph({
        children: [new TextRun({ text: `â€¢ NÃºmero de cuotas: ${label}.` })],
        spacing: { after: 80 },
        indent: { left: convertInchesToTwip(0.3) },
      }));
    }
    if (interes) {
      out.push(new Paragraph({
        children: [new TextRun({ text: `â€¢ InterÃ©s reconocido: ${interes.replace(/\.$/, "")}.` })],
        spacing: { after: 80 },
        indent: { left: convertInchesToTwip(0.3) },
      }));
    }
    if (inicioKey) {
      out.push(new Paragraph({
        children: [new TextRun({ text: `â€¢ Inicio de pagos: ${formatDateLong(inicioKey)}.` })],
        spacing: { after: 80 },
        indent: { left: convertInchesToTwip(0.3) },
      }));
    }
    if (finKey) {
      out.push(new Paragraph({
        children: [new TextRun({ text: `â€¢ Fecha fin pagos: ${formatDateLong(finKey)}.` })],
        spacing: { after: 80 },
        indent: { left: convertInchesToTwip(0.3) },
      }));
    }

    out.push(new Paragraph({
      children: [new TextRun({ text: "" })],
      spacing: { after: 120 },
    }));
  });

  return out;
}

async function saveActaAudienciaSnapshot(params: {
  payload: TerminarAudienciaPayload;
  uploaded: { id: string; name: string; webViewLink?: string | null; webContentLink?: string | null };
}) {
  const supabase = createSupabaseAdmin();
  if (!supabase) return null;

  const payload = params.payload;

  const pp1 = payload.propuestaPago?.primera_clase ?? {};
  const pp3 = payload.propuestaPago?.tercera_clase ?? {};
  const pp5 = payload.propuestaPago?.quinta_clase ?? {};

  const cleanText = (v: unknown) => {
    const s = String(v ?? "").trim();
    return s ? s : null;
  };
  const cleanDate = (v: unknown) => {
    const s = String(v ?? "").trim();
    return s ? s : null; // let Postgres cast if it's YYYY-MM-DD
  };

  const row = {
    proceso_id: payload.procesoId,
    evento_id: payload.eventoId ?? null,
    tipo_documento: payload.tipoDocumento ?? null,
    titulo: payload.titulo ?? null,
    ciudad: payload.ciudad ?? null,
    fecha: payload.fecha,
    hora: payload.hora ?? null,

    pp_primera_numero_cuotas: parseCuotas(pp1.numero_cuotas),
    pp_primera_interes_reconocido: cleanText(pp1.interes_reconocido),
    pp_primera_inicio_pagos: cleanDate(pp1.inicio_pagos),
    pp_primera_fecha_fin_pagos: cleanDate(pp1.fecha_fin_pagos),

    pp_tercera_numero_cuotas: parseCuotas(pp3.numero_cuotas),
    pp_tercera_interes_reconocido: cleanText(pp3.interes_reconocido),
    pp_tercera_inicio_pagos: cleanDate(pp3.inicio_pagos),
    pp_tercera_fecha_fin_pagos: cleanDate(pp3.fecha_fin_pagos),

    pp_quinta_numero_cuotas: parseCuotas(pp5.numero_cuotas),
    pp_quinta_interes_reconocido: cleanText(pp5.interes_reconocido),
    pp_quinta_inicio_pagos: cleanDate(pp5.inicio_pagos),
    pp_quinta_fecha_fin_pagos: cleanDate(pp5.fecha_fin_pagos),

    resumen: (payload.resumen ?? null) as any,
    asistentes: (payload.asistentes ?? null) as any,
    acreencias: (payload.acreencias ?? null) as any,
    propuesta_pago: (payload.propuestaPago ?? null) as any,

    drive_file_id: params.uploaded.id,
    drive_file_name: params.uploaded.name,
    drive_web_view_link: params.uploaded.webViewLink ?? null,
  };

  const { data, error } = await (supabase as any)
    .from("actas_audiencia")
    .insert(row)
    .select("id")
    .maybeSingle();

  if (error) {
    console.warn("[terminar-audiencia] Unable to save acta snapshot:", error.message);
    return null;
  }
  return (data?.id as string | undefined) ?? null;
}

function formatDateParts(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { day: "â€”", month: "â€”", year: "â€”" };
  return {
    day: parsed.getDate().toString(),
    month: parsed.toLocaleDateString("es-CO", { month: "long" }),
    year: parsed.getFullYear().toString(),
  };
}

function capitalizeFirst(input: string) {
  if (!input) return input;
  return input.slice(0, 1).toUpperCase() + input.slice(1);
}

function numberToSpanish0to99(n: number): string {
  const x = Math.trunc(n);
  if (!Number.isFinite(x) || x < 0 || x > 99) return String(n);

  const units: Record<number, string> = {
    0: "cero",
    1: "uno",
    2: "dos",
    3: "tres",
    4: "cuatro",
    5: "cinco",
    6: "seis",
    7: "siete",
    8: "ocho",
    9: "nueve",
  };

  const specials: Record<number, string> = {
    10: "diez",
    11: "once",
    12: "doce",
    13: "trece",
    14: "catorce",
    15: "quince",
    16: "diecisÃ©is",
    17: "diecisiete",
    18: "dieciocho",
    19: "diecinueve",
    20: "veinte",
    21: "veintiuno",
    22: "veintidÃ³s",
    23: "veintitrÃ©s",
    24: "veinticuatro",
    25: "veinticinco",
    26: "veintisÃ©is",
    27: "veintisiete",
    28: "veintiocho",
    29: "veintinueve",
  };

  if (x in units) return units[x];
  if (x in specials) return specials[x];

  const tensMap: Record<number, string> = {
    3: "treinta",
    4: "cuarenta",
    5: "cincuenta",
    6: "sesenta",
    7: "setenta",
    8: "ochenta",
    9: "noventa",
  };

  const tens = Math.trunc(x / 10);
  const unit = x % 10;
  const tensWord = tensMap[tens] ?? String(tens * 10);
  return unit === 0 ? tensWord : `${tensWord} y ${units[unit] ?? String(unit)}`;
}

function yearToSpanishWords(year: number): string {
  const y = Math.trunc(year);
  if (!Number.isFinite(y)) return String(year);
  if (y < 2000 || y > 2099) return String(year);

  const rest = y - 2000;
  if (rest === 0) return "dos mil";
  return `dos mil ${numberToSpanish0to99(rest)}`;
}

function formatAutoNulidadFechaLinea(ciudad: string, fechaKey: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fechaKey).trim());
  if (!m) return `${ciudad}, a los [DIA] dÃ­as del mes de [MES] del aÃ±o [AÃ‘O].`;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);

  const months = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ];
  const monthName = months[month - 1] ?? String(month);

  const dayWord = capitalizeFirst(numberToSpanish0to99(day));
  const yearWords = yearToSpanishWords(year);

  return `${ciudad}, a los ${dayWord} (${day}) dÃ­as del mes de ${monthName} del aÃ±o ${yearWords} (${year}).`;
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

type VotoAcuerdo = "POSITIVO" | "NEGATIVO" | "AUSENTE" | "ABSTENCION";

function normalizeVotoAcuerdo(value: string | null | undefined): VotoAcuerdo | null {
  const raw = value?.trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();

  if (upper.includes("POSITIV")) return "POSITIVO";
  if (upper.includes("NEGATIV")) return "NEGATIVO";
  if (upper.includes("AUSENT")) return "AUSENTE";
  if (upper.includes("ABSTEN")) return "ABSTENCION";
  return null;
}

function computeVotosAcuerdo(acreencias: AcreenciaRow[]) {
  const hasVotes = acreencias.some((a) => normalizeVotoAcuerdo(a.voto) !== null);
  const totals: Record<VotoAcuerdo, number> = {
    POSITIVO: 0,
    NEGATIVO: 0,
    AUSENTE: 0,
    ABSTENCION: 0,
  };

  if (!hasVotes) return { hasVotes, totals };

  acreencias.forEach((a) => {
    const pct = a.porcentaje;
    if (typeof pct !== "number" || Number.isNaN(pct)) return;
    const voto = normalizeVotoAcuerdo(a.voto) ?? "AUSENTE";
    totals[voto] += pct;
  });

  return { hasVotes, totals };
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

function isNumericLikeText(value: string) {
  return /^[\d\s.,$%()-]+$/.test(value.trim());
}

function createExcelMetadataTable(metadata: Array<{ label: string; value: string }>) {
  const tableWidth = convertInchesToTwip(8.5 - 1.2);
  const columnWidths = [62, 38].map((pct) => Math.round((tableWidth * pct) / 100));
  const currentTotal = columnWidths.reduce((sum, width) => sum + width, 0);
  if (currentTotal !== tableWidth) {
    columnWidths[columnWidths.length - 1] += tableWidth - currentTotal;
  }

  return new Table({
    rows: metadata.map(
      (item) =>
        new TableRow({
          children: [
            new TableCell({
              children: [
                new Paragraph({
                  children: [new TextRun({ text: item.label, bold: true, size: 20 })],
                }),
              ],
              borders: tableBorders,
            }),
            new TableCell({
              children: [
                new Paragraph({
                  children: [new TextRun({ text: item.value, size: 20 })],
                  alignment: isNumericLikeText(item.value) ? AlignmentType.RIGHT : AlignmentType.LEFT,
                }),
              ],
              borders: tableBorders,
            }),
          ],
        })
    ),
    width: { size: tableWidth, type: WidthType.DXA },
    columnWidths,
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
    layout: TableLayoutType.FIXED,
    alignment: AlignmentType.CENTER,
  });
}

function createExcelDocTable(table: ExcelDocTable) {
  const tableWidth = convertInchesToTwip(8.5 - 1.2);
  const colCount = Math.max(1, table.headers.length);
  const baseWidth = Math.floor(tableWidth / colCount);
  const columnWidths = Array.from({ length: colCount }, () => baseWidth);
  const currentTotal = columnWidths.reduce((sum, width) => sum + width, 0);
  if (currentTotal !== tableWidth) {
    columnWidths[columnWidths.length - 1] += tableWidth - currentTotal;
  }

  const headerRow = new TableRow({
    children: table.headers.map(
      (header) =>
        new TableCell({
          children: [
            new Paragraph({
              children: [new TextRun({ text: header, bold: true, size: 20 })],
              alignment: AlignmentType.CENTER,
            }),
          ],
          borders: tableBorders,
          shading: { fill: "E0E0E0" },
        })
    ),
  });

  const bodyRows = table.rows.map(
    (row) =>
      new TableRow({
        children: table.headers.map((_, idx) => {
          const value = sanitizeCellText(row[idx]);
          return new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text: value, size: 18 })],
                alignment: isNumericLikeText(value) ? AlignmentType.RIGHT : AlignmentType.LEFT,
              }),
            ],
            borders: tableBorders,
          });
        }),
      })
  );

  return new Table({
    rows: [headerRow, ...bodyRows],
    width: { size: tableWidth, type: WidthType.DXA },
    columnWidths,
    margins: { top: 40, bottom: 40, left: 40, right: 40 },
    layout: TableLayoutType.FIXED,
    alignment: AlignmentType.CENTER,
  });
}

function createAcreenciasTable(acreencias: AcreenciaRow[]) {
  const headers = ["ACREEDOR", "NATURALEZA", "PRELACION", "CAPITAL", "INT. CTE.", "INT. MORA", "DIAS DE MORA", "OTROS COBROS/ SEGUROS", "TOTAL", "%"];
  const columnWidths = [16, 9, 7, 10, 8, 8, 8, 13, 13, 8];
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
            children: [new Paragraph({ children: [new TextRun({ text: a.acreedor?.trim() || "â€”", size: 18 })] })],
            borders: tableBorders,
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: a.naturaleza?.trim() || "â€”", size: 18 })] })],
            borders: tableBorders,
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: a.prelacion?.trim() || "â€”", size: 18 })], alignment: AlignmentType.CENTER })],
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
            children: [new Paragraph({ children: [new TextRun({ text: a.dias_mora != null ? String(a.dias_mora) : "—", size: 18 })], alignment: AlignmentType.RIGHT })],
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
      new TableCell({ children: [new Paragraph("")], borders: tableBorders, shading: { fill: "E0E0E0" } }),
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

function buildAsistentesParagraphs(asistentes: Asistente[]): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  asistentes.forEach((asistente) => {
    const ausente = asistente.estado !== "Presente";
    const parts: TextRun[] = [];

    if (asistente.categoria === "Apoderado") {
      const calidad = String(asistente.calidadApoderadoDe ?? "").trim();
      const calidadLower = calidad.toLowerCase();
      if (!calidadLower.includes("acreedor")) return;

      // Format: NAME, ciudadano mayor de edad, e identificado con cedula de ciudadanÃ­a nÃºmero X,
      // portador de la tarjeta profesional No. X del CSJ, con correo electrÃ³nico X,
      // en calidad de apoderado de [DEUDOR/ACREEDOR]
      parts.push(new TextRun({ text: asistente.nombre.toUpperCase(), bold: true }));
      parts.push(new TextRun({ text: ", ciudadana mayor de edad, e identificada con cedula de ciudadanÃ­a nÃºmero " }));
      parts.push(new TextRun({ text: asistente.identificacion || "[IDENTIFICACIÃ“N]" }));

      if (asistente.tarjetaProfesional) {
        parts.push(new TextRun({ text: ", portadora de la tarjeta profesional No. " }));
        parts.push(new TextRun({ text: asistente.tarjetaProfesional }));
        parts.push(new TextRun({ text: " del CSJ" }));
      }

      if (asistente.email) {
        parts.push(new TextRun({ text: ", con correo electrÃ³nico " }));
        parts.push(new TextRun({ text: asistente.email }));
      }

      if (calidad) {
        parts.push(new TextRun({ text: ", en calidad de apoderada de " }));
        parts.push(new TextRun({ text: calidad }));
      }
      parts.push(new TextRun({ text: "." }));
      if (ausente) parts.push(new TextRun({ text: " (AUSENTE)", bold: true }));
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
      if (ausente) parts.push(new TextRun({ text: " (AUSENTE)", bold: true }));
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
      : "[IDENTIFICACIÃ“N]";

  let operadorNombre = payload.operador?.nombre || "JOSE ALEJANDRO PARDO MARTINEZ";
  let operadorId = payload.operador?.identificacion || "1.154.967.376";
  const operadorTp = payload.operador?.tarjetaProfesional || "429.496";
  let operadorEmail = payload.operador?.email || "fundaseer@gmail.com";

  // If the request came from an evento, the operador is the event owner (eventos.usuario_id).
  // Respect operador explicitly provided by the client; only fall back to evento owner if missing.
  const defaultOperadorNombre = "JOSE ALEJANDRO PARDO MARTINEZ";
  const defaultOperadorEmail = "fundaseer@gmail.com";
  const defaultOperadorIdentificacion = "1.154.967.376";
  const payloadOperadorNombre = payload.operador?.nombre?.trim() ?? "";
  const payloadOperadorEmail = payload.operador?.email?.trim() ?? "";
  const payloadOperadorIdentificacion = payload.operador?.identificacion?.trim() ?? "";
  const shouldUseEventoNombre =
    !payloadOperadorNombre || payloadOperadorNombre.toUpperCase() === defaultOperadorNombre;
  const shouldUseEventoEmail =
    !payloadOperadorEmail || payloadOperadorEmail.toLowerCase() === defaultOperadorEmail;
  const shouldUseEventoIdentificacion =
    !payloadOperadorIdentificacion ||
    payloadOperadorIdentificacion === defaultOperadorIdentificacion;

  if (shouldUseEventoNombre && eventoContext?.usuario?.nombre) operadorNombre = eventoContext.usuario.nombre;
  if (shouldUseEventoEmail && eventoContext?.usuario?.email) operadorEmail = eventoContext.usuario.email;
  if (
    shouldUseEventoIdentificacion &&
    eventoContext?.usuario?.identificacion &&
    String(eventoContext.usuario.identificacion).trim()
  ) {
    operadorId = String(eventoContext.usuario.identificacion).trim();
  }

  const operadorFirmaDataUrl =
    eventoContext?.usuario?.firma_data_url ?? (await loadUsuarioFirmaDataUrlByEmail(operadorEmail));
  const operadorSignatureImage = decodeSignatureDataUrl(operadorFirmaDataUrl);

  const proximaFecha = payload.proximaAudiencia?.fecha
    ? formatDateLong(payload.proximaAudiencia.fecha)
    : "[FECHA PRÃ“XIMA AUDIENCIA]";
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
  const tipoDoc = (payload.tipoDocumento || "ACTA AUDIENCIA").trim().toUpperCase();
  const isBilateralFracaso = tipoDoc === "ACUERDO DE PAGO BILATERAL Y FRACASO DEL TRAMITE";
  const excelDocData = await loadExcelDocData(
    payload.procesoId,
    payload.acreencias,
    payload.excelArchivo,
    payload.debug === true
  );
  const docHeader = await loadFundaseerHeader();
  if (payload.debug) {
    console.log("[buildDocx] Document type / excel summary", {
      tipoDoc,
      hasExcelDocData: Boolean(excelDocData),
      projectionTables: excelDocData?.projectionTables.length ?? 0,
      votingRows: excelDocData?.votingTable?.rows.length ?? 0,
      excelDriveFileId: excelDocData?.source.drive_file_id ?? null,
      excelDriveFileName: excelDocData?.source.drive_file_name ?? null,
    });
  }
  const docTitle = isBilateralFracaso
    ? "ACTA DE ACUERDO DE PAGO BILATERAL Y FRACASO DEL TRAMITE"
    : tipoDoc;

  // Custom document for "AUTO DECLARA NULIDAD" (requested template).
  if (tipoDoc === "AUTO DECLARA NULIDAD") {
    let autoTitulo = (payload.titulo || "").trim();
    if (!autoTitulo || autoTitulo.toLowerCase() === "llamado de asistencia") {
      autoTitulo = "AUTO No. [NUMERO]";
    }

    portraitBefore.push(new Paragraph({
      children: [new TextRun({ text: autoTitulo, bold: true, size: 28 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 260 },
    }));

    portraitBefore.push(new Paragraph({
      children: [new TextRun({ text: "PROCESO DE NEGOCIACIÃ“N DE DEUDAS", bold: true, size: 24 })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 260 },
    }));

    portraitBefore.push(new Paragraph({
      children: [new TextRun({ text: "Deudora" })],
      spacing: { after: 60 },
    }));

    portraitBefore.push(new Paragraph({
      children: [new TextRun({ text: deudorNombre.toUpperCase() })],
      spacing: { after: 60 },
    }));

    portraitBefore.push(new Paragraph({
      children: [new TextRun({ text: `C.C. ${deudorId}` })],
      spacing: { after: 260 },
    }));

    portraitBefore.push(new Paragraph({
      children: [new TextRun({ text: formatAutoNulidadFechaLinea(ciudad, payload.fecha) })],
      spacing: { after: 260 },
    }));

    portraitBefore.push(new Paragraph({
      children: [
        new TextRun({
          text:
            "Se informa a las partes que realizando un control de legalidad posterior, se avizora que la deudora insolvente manifiesta que el poder aportado no fue suscrito por ella, razÃ³n por la cual en cumplimiento con el parÃ¡grafo 1 del articulo 539 de la ley 1564 de 2012, modificada por el articulo 10 de la ley 2445 de 2025 se procederÃ¡ con lo correspondiente.",
        }),
      ],
      spacing: { after: 200 },
    }));

    portraitBefore.push(new Paragraph({
      children: [new TextRun({ text: "CONTROL DE LEGALIDAD", bold: true, size: 24 })],
      spacing: { before: 120, after: 160 },
    }));

    portraitBefore.push(new Paragraph({
      children: [
        new TextRun({
          text:
            "El operador de insolvencia, investido de facultades jurisdiccionales establecidas en el numeral 4 del ArtÃ­culo 116 de la C.P, numeral 3 del ArtÃ­culo 13 de la Ley Estatutaria de Justicia y el ParÃ¡grafo del ArtÃ­culo 537 del CÃ³digo General del Proceso, de conformidad a lo establecido en el ArtÃ­culo 132 del CÃ³digo General del Proceso, realiza Control de Legalidad con el objeto de sanear los vicios y errores que se hayan podido causar en el Auto de AdmisiÃ³n y, en este sentido tenemos que se genera una nulidad en virtud a la falta de firma y soporte de remisiÃ³n de poder especial por parte de la deudora el cual fue aportado por parte de la firma jurÃ­dica que radicÃ³ su solicitud de insolvencia.",
        }),
      ],
      spacing: { after: 200 },
    }));

    portraitBefore.push(new Paragraph({
      children: [
        new TextRun({
          text:
            "Por lo que, en consecuencia, se acoge la peticiÃ³n como nulidad absoluta que no pueda sanearse en este estado del proceso por lo que habrÃ¡ de declararse la nulidad de todo lo actuado dentro del presente tramite de insolvencia, debiendo notificar a las partes de lo correspondiente.",
        }),
      ],
      spacing: { after: 200 },
    }));

    const portraitPage = {
      margin: {
        top: convertInchesToTwip(1.15),
        right: convertInchesToTwip(0.6),
        bottom: convertInchesToTwip(0.6),
        left: convertInchesToTwip(0.6),
        header: convertInchesToTwip(0.2),
      },
      size: {
        width: convertInchesToTwip(8.5),
        height: convertInchesToTwip(11),
        orientation: PageOrientation.PORTRAIT,
      },
    };

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
      sections: [buildSection(portraitPage, docHeader, portraitBefore)],
    });

    return Packer.toBuffer(doc);
  }

  // Custom document for "ACTA RECHAZO DEL TRAMITE" (requested template).
  if (tipoDoc === "ACTA RECHAZO DEL TRAMITE" || tipoDoc === "ACTA RECHAZO DEL TRÃMITE") {
    portraitBefore.push(new Paragraph({
      children: [new TextRun({ text: "ACTA DE RECHAZO:", bold: true, size: 28 })],
      alignment: AlignmentType.LEFT,
      spacing: { after: 260 },
    }));

    portraitBefore.push(new Paragraph({
      children: [
        new TextRun({
          text: `${operadorNombre.toUpperCase()}, mayor de edad, identificado con cedula ${operadorId} actuando en calidad OPERADOR EN INSOLVENCIA designado para el proceso de insolvencia de persona natural no comerciante del seÃ±or ${deudorNombre.toUpperCase()}, con cedula de ciudadanÃ­a No. ${deudorId}, Por medio del presente, el suscrito conciliador resuelve:`,
        }),
      ],
      spacing: { after: 260 },
    }));

    portraitBefore.push(new Paragraph({
      children: [
        new TextRun({
          text:
            `PRIMERO: RECHAZAR el trÃ¡mite del seÃ±or ${deudorNombre.toUpperCase()}, identificado con la cedula de ciudadanÃ­a No. ${deudorId}, con fundamento en las observaciones presentadas por la acreedora de SCOTIABANK COLPATRIA, quien manifestÃ³ las siguientes inconsistencias y omisiones frente al escrito de insolvencia radicado:`,
        }),
      ],
      spacing: { after: 200 },
    }));

    portraitBefore.push(new Paragraph({
      children: [
        new TextRun({
          text:
            "SEGUNDO: RESPECTO A LA RELACICON DE ACREENCIAS. La acreedora de SCCOTIABANK COLPATRIA manifestÃ³ que en el escrito de insolvencia presentado por el apoderado de la parte deudora no se incluyÃ³ al acreedor AJOVER DARNEL S.A.S., a pesar de que este cuenta con una obligaciÃ³n vigente frente al deudor.",
        }),
      ],
      spacing: { after: 200 },
    }));

    portraitBefore.push(new Paragraph({
      children: [
        new TextRun({
          text:
            "TERCERO: OMISION DEL ACREEDDOR POR IMPUESTO PREDIAL. Se evidenciÃ³ que el deudor no mencionÃ³ en la relaciÃ³n de acreencias al acreedor ALCALDÃA DE PALMIRA, correspondiente al impuesto predial del inmueble objeto de la solicitud, omitiendo asÃ­ informaciÃ³n relevante y obligatoria dentro del trÃ¡mite.",
        }),
      ],
      spacing: { after: 200 },
    }));

    portraitBefore.push(new Paragraph({
      children: [
        new TextRun({
          text:
            "CUARTO: INCONSISTENCIAS EN LA CALIDAD DEL DEUDOR. De acuerdo con la informaciÃ³n allegada, el deudor aparece como accionista y codeudor de la sociedad IMEXCYAN TRADING S.A.S., situaciÃ³n que contradice su manifestaciÃ³n de ser persona natural no comerciante, generando duda sobre la procedencia del trÃ¡mite.",
        }),
      ],
      spacing: { after: 200 },
    }));

    portraitBefore.push(new Paragraph({
      children: [
        new TextRun({
          text:
            "QUINTO: INCONSISTENCIAS EN LA RELACICON DE ACREEDORES. Se observa ademÃ¡s que al relacionar al acreedor RENTAL INMOBILIARIA, el deudor indica que se trata de un crÃ©dito de libranza, situaciÃ³n que resulta incongruente, por cuanto una inmobiliaria no es una entidad autorizada para el otorgamiento de crÃ©ditos de dicha naturaleza. Esto evidencia falta de claridad en la informaciÃ³n presentada.",
        }),
      ],
      spacing: { after: 260 },
    }));

    portraitBefore.push(new Paragraph({
      children: [new TextRun({ text: "Atentamente," })],
      spacing: { after: 260 },
    }));

    // Signature block (exact as requested).
    if (operadorSignatureImage) {
      portraitBefore.push(new Paragraph({
        children: [
          new ImageRun({
            type: operadorSignatureImage.type,
            data: operadorSignatureImage.data,
            transformation: { width: 190, height: 70 },
          }),
        ],
        spacing: { after: 140 },
      }));
    } else {
      portraitBefore.push(new Paragraph({ children: [new TextRun({ text: "" })], spacing: { after: 200 } }));
      portraitBefore.push(new Paragraph({ children: [new TextRun({ text: "" })], spacing: { after: 200 } }));
    }

    portraitBefore.push(new Paragraph({
      children: [new TextRun({ text: operadorNombre.toUpperCase(), bold: true })],
      spacing: { after: 60 },
    }));
    portraitBefore.push(new Paragraph({
      children: [new TextRun({ text: "Conciliador Extrajudicial en Derecho y Operador en Insolvencias" })],
      spacing: { after: 60 },
    }));
    portraitBefore.push(new Paragraph({
      children: [new TextRun({ text: `C. C. No. ${operadorId}` })],
      spacing: { after: 60 },
    }));
    portraitBefore.push(new Paragraph({
      children: [new TextRun({ text: `T. P. No. ${operadorTp} del C S de la J.` })],
      spacing: { after: 60 },
    }));
    portraitBefore.push(new Paragraph({
      children: [new TextRun({ text: `Email: ${operadorEmail}` })],
      spacing: { after: 200 },
    }));

    const portraitPage = {
      margin: {
        top: convertInchesToTwip(1.15),
        right: convertInchesToTwip(0.6),
        bottom: convertInchesToTwip(0.6),
        left: convertInchesToTwip(0.6),
        header: convertInchesToTwip(0.2),
      },
      size: {
        width: convertInchesToTwip(8.5),
        height: convertInchesToTwip(11),
        orientation: PageOrientation.PORTRAIT,
      },
    };

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
      sections: [buildSection(portraitPage, docHeader, portraitBefore)],
    });

    return Packer.toBuffer(doc);
  }

  sections.push(new Paragraph({
    children: [new TextRun({ text: docTitle, bold: true, size: 28 })],
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
  }));

  const subtitulosPorTipo: Record<string, string> = {
    "ACTA AUDIENCIA": "AUDIENCIA NEGOCIACION DE DEUDAS",
    "ACTA SUSPENSIÓN": "SUSPENSION DE AUDIENCIA NEGOCIACION DE DEUDAS",
    "ACUERDO DE PAGO": "ACUERDO DE PAGO NEGOCIACION DE DEUDAS",
    "ACUERDO DE PAGO BILATERAL Y FRACASO DEL TRAMITE": "ACUERDO DE PAGO BILATERAL Y FRACASO DEL TRAMITE",
    "ACTA FRACASO DEL TRAMITE": "FRACASO DEL TRAMITE DE NEGOCIACION DE DEUDAS",
    "ACTA RECHAZO DEL TRAMITE": "RECHAZO DEL TRAMITE DE NEGOCIACION DE DEUDAS",
    "AUTO DECLARA NULIDAD": "AUTO QUE DECLARA LA NULIDAD",
  };
  const subtitulo = isBilateralFracaso
    ? "NEGOCIACION DE DEUDAS"
    : (subtitulosPorTipo[tipoDoc] || "NEGOCIACION DE DEUDAS");

  sections.push(new Paragraph({
    children: [new TextRun({ text: subtitulo, bold: true, size: 24 })],
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
      new TextRun({ text: `En ${ciudad}, a los ${dateParts.day} dÃ­as del mes de ${dateParts.month} de ${dateParts.year}, siendo las ${horaActa.fullLower}, se reunieron en Audiencia en el Centro de ConciliaciÃ³n Fundaseer, las siguientes personas:` }),
    ],
    spacing: { after: 300 },
  }));

  // Asistentes section: include acreedores and apoderados de acreedores (present AND absent).
  // Present ones go first, absent ones after.
  const asistentesAcreedores = payload.asistentes
    .filter((a) => {
      if (a.categoria === "Acreedor") return true;
      if (a.categoria !== "Apoderado") return false;
      return String(a.calidadApoderadoDe ?? "").toLowerCase().includes("acreedor");
    })
    .sort((a, b) => {
      const aPresente = a.estado === "Presente" ? 0 : 1;
      const bPresente = b.estado === "Presente" ? 0 : 1;
      return aPresente - bPresente;
    });
  const asistentesParagraphs = buildAsistentesParagraphs(asistentesAcreedores);
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
        text: "Conforme al tÃ­tulo IV la ley 1564 de 2012 se adelanta la presente audiencia de ConciliaciÃ³n dentro del trÃ¡mite de insolvencia de persona natural no comerciante solicitada por el seÃ±or ",
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
          text: `Siendo las ${horaActa.fullUpper} el conciliador designado, le da inicio a la diligencia programada para el dÃ­a de Hoy, verificando la asistencia de las partes, `,
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
          text: "Siguiendo los parÃ¡metros del artÃ­culo 550 del CÃ³digo General del Proceso (Desarrollo de la audiencia de NegociaciÃ³n de Deudas 1.- El conciliador pondrÃ¡ en conocimiento de los acreedores la relaciÃ³n detallada de las acreencias y les preguntarÃ¡ si estÃ¡n de acuerdo con la existencia, naturaleza y cuantÃ­a de las obligaciones relacionadas por parte del deudor y si tienen dudas o discrepancias con relaciÃ³n a las propias o respecto de otras acreencias.",
        }),
      ],
      spacing: { after: 300 },
    }));
  }

  // CREDITOS / GRADUACION Y CALIFICACION
  if (payload.acreencias.length > 0) {
    sections = landscapeAcreencias;
  }

  sections.push(new Paragraph({
    children: [new TextRun({
      text: (tipoDoc === "ACUERDO DE PAGO BILATERAL Y FRACASO DEL TRAMITE")
        ? "CREDITOS"
        : (tipoDoc === "ACTA FRACASO DEL TRAMITE")
          ? "GRADUACION Y CALIFICACION DE CREDITOS"
          : "GRADUACION Y CALIFICACION PROVISIONAL DE CREDITOS",
      bold: true,
      size: 24,
    })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 200 },
  }));

  if (payload.acreencias.length > 0) {
    sections.push(createAcreenciasTable(payload.acreencias));

    const acreedores = payload.acreencias
      .map((a) => a.acreedor?.trim() ?? "")
      .filter(Boolean);
    const uniqueAcreedores = [...new Set(acreedores)];

    if (tipoDoc !== "ACUERDO DE PAGO BILATERAL Y FRACASO DEL TRAMITE") {
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
    }

    sections = portraitAfter;
  }

  if (tipoDoc.startsWith("ACUERDO DE PAGO")) {
    const votosAcuerdo = computeVotosAcuerdo(payload.acreencias);
    // --- PROPUESTA DE PAGO ---
    sections.push(new Paragraph({
      children: [new TextRun({ text: "PROPUESTA DE PAGO", bold: true, size: 24 })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 200 },
    }));

    sections.push(new Paragraph({
      children: [
        new TextRun({
          text: "Acto seguido el/la suscrito(a) conciliador(a) continua con el desarrollo del numeral 5 y 6 del art. 550 del CGP, que estipula que el deudor haga una exposiciÃ³n de la propuesta de pago, para lo cual le concede el uso de la palabra al apoderado del deudor quien indica:",
        }),
      ],
      spacing: { after: 200 },
    }));

    sections.push(...buildPropuestaPagoParagraphs(payload));

    // --- VOTACIÃ“N DEL ACUERDO ---
    sections.push(new Paragraph({
      children: [new TextRun({ text: "VOTACIÃ“N DEL ACUERDO", bold: true, size: 24 })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 200 },
    }));

    sections.push(new Paragraph({
      children: [
        new TextRun({
          text: "Indicando a los acreedores que la propuesta de pago y proyecciÃ³n de este fue socializado a los correos electrÃ³nicos. Se corre traslado de la propuesta de pago a los acreedores, los cuales proceden a votar de la siguiente manera:",
        }),
      ],
      spacing: { after: 200 },
    }));

    if (excelDocData?.votingTable && excelDocData.votingTable.rows.length > 0) {
      sections.push(new Paragraph({
        children: [
          new TextRun({
            text: `Tabla de votaciÃ³n tomada del archivo Excel: ${excelDocData.source.drive_file_name}`,
            italics: true,
            size: 18,
          }),
        ],
        spacing: { after: 120 },
      }));
      sections.push(createExcelDocTable(excelDocData.votingTable));
    } else if (payload.acreencias.length > 0) {
      // Voting table from acreencias data
      const votingHeaders = ["ACREEDORES", "CAPITAL", "%", "VOTO"];
      const votingColWidths = [40, 25, 15, 20];
      const votingTableWidth = convertInchesToTwip(8.5 - 1.2);
      const votingColTwip = votingColWidths.map((pct) => Math.round((votingTableWidth * pct) / 100));
      const votingTwipSum = votingColTwip.reduce((a, v) => a + v, 0);
      if (votingColTwip.length > 0 && votingTwipSum !== votingTableWidth) {
        votingColTwip[votingColTwip.length - 1] += votingTableWidth - votingTwipSum;
      }

      const votingHeaderRow = new TableRow({
        children: votingHeaders.map(
          (h) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20 })], alignment: AlignmentType.CENTER })],
              borders: tableBorders,
              shading: { fill: "E0E0E0" },
            })
        ),
      });

      let totalCapitalVoting = 0;
      payload.acreencias.forEach((a) => { totalCapitalVoting += a.capital ?? 0; });

      const votingBodyRows = payload.acreencias.map(
        (a) =>
          new TableRow({
            children: [
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: a.acreedor?.trim() || "â€”", size: 20 })] })],
                borders: tableBorders,
              }),
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: formatCurrency(a.capital), size: 20 })], alignment: AlignmentType.RIGHT })],
                borders: tableBorders,
              }),
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: formatPercentage(a.porcentaje), size: 20 })], alignment: AlignmentType.RIGHT })],
                borders: tableBorders,
              }),
              new TableCell({
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: votosAcuerdo.hasVotes ? (normalizeVotoAcuerdo(a.voto) ?? "AUSENTE") : "[VOTO]",
                        size: 20,
                      }),
                    ],
                    alignment: AlignmentType.CENTER,
                  }),
                ],
                borders: tableBorders,
              }),
            ],
          })
      );

      const votingTotalsRow = new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "TOTAL CAPITAL", bold: true, size: 20 })] })],
            borders: tableBorders,
            shading: { fill: "E0E0E0" },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: formatCurrency(totalCapitalVoting), bold: true, size: 20 })], alignment: AlignmentType.RIGHT })],
            borders: tableBorders,
            shading: { fill: "E0E0E0" },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "100%", bold: true, size: 20 })], alignment: AlignmentType.RIGHT })],
            borders: tableBorders,
            shading: { fill: "E0E0E0" },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "", size: 20 })] })],
            borders: tableBorders,
            shading: { fill: "E0E0E0" },
          }),
        ],
      });

      sections.push(new Table({
        rows: [votingHeaderRow, ...votingBodyRows, votingTotalsRow],
        width: { size: votingTableWidth, type: WidthType.DXA },
        columnWidths: votingColTwip,
        margins: { top: 40, bottom: 40, left: 40, right: 40 },
        layout: TableLayoutType.FIXED,
        alignment: AlignmentType.CENTER,
      }));
    }

    // --- RELACIÃ“N FINAL DE LOS VOTOS ---
    sections.push(new Paragraph({
      children: [new TextRun({ text: "RELACIÃ“N FINAL DE LOS VOTOS", bold: true, size: 24 })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 200 },
    }));

    const voteHeaders = ["VOTOS POSITIVOS", "VOTOS NEGATIVOS", "VOTOS AUSENTES", "ABSTENCIÃ“N DE VOTO"];
    const voteColWidth = convertInchesToTwip(8.5 - 1.2);
    const voteColTwip = [25, 25, 25, 25].map((pct) => Math.round((voteColWidth * pct) / 100));
    const vtSum = voteColTwip.reduce((a, v) => a + v, 0);
    if (voteColTwip.length > 0 && vtSum !== voteColWidth) {
      voteColTwip[voteColTwip.length - 1] += voteColWidth - vtSum;
    }

    const finalVoteValues = votosAcuerdo.hasVotes
      ? [
          formatPercentage(votosAcuerdo.totals.POSITIVO),
          formatPercentage(votosAcuerdo.totals.NEGATIVO),
          formatPercentage(votosAcuerdo.totals.AUSENTE),
          formatPercentage(votosAcuerdo.totals.ABSTENCION),
        ]
      : ["[__%]", "[__%]", "[__%]", "[__%]"];

    sections.push(new Table({
      rows: [
        new TableRow({
          children: voteHeaders.map(
            (h) =>
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20 })], alignment: AlignmentType.CENTER })],
                borders: tableBorders,
                shading: { fill: "E0E0E0" },
              })
          ),
        }),
        new TableRow({
          children: finalVoteValues.map(
            (v) =>
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: v, size: 20 })], alignment: AlignmentType.CENTER })],
                borders: tableBorders,
              })
          ),
        }),
      ],
      width: { size: voteColWidth, type: WidthType.DXA },
      columnWidths: voteColTwip,
      margins: { top: 40, bottom: 40, left: 40, right: 40 },
      layout: TableLayoutType.FIXED,
      alignment: AlignmentType.CENTER,
    }));

    // Agreement declaration / Bilateral + fracaso narrative
    if (tipoDoc === "ACUERDO DE PAGO BILATERAL Y FRACASO DEL TRAMITE") {
      sections.push(new Paragraph({
        children: [
          new TextRun({ text: "A partir de la votaciÃ³n realizada, se determina que entre el seÃ±or " }),
          new TextRun({ text: deudorNombre.toUpperCase(), bold: true }),
          new TextRun({
            text:
              " y sus acreedores no alcanza el coeficiente exigido para la aprobaciÃ³n del acuerdo de pago general. Ante la ausencia de los acreedores requeridos y considerando que el artÃ­culo 553 del CÃ³digo General del Proceso exige la participaciÃ³n de dos o mÃ¡s acreedores que representen mÃ¡s del cincuenta por ciento (50%) del monto total del capital adeudado para que se configure un acuerdo de pago general. Sin embargo, en atenciÃ³n a lo previsto en el numeral 3 del artÃ­culo 21 de la Ley 2445 de 2025, que modificÃ³ el numeral 3 del artÃ­culo 553 del CÃ³digo General del Proceso, y en virtud del voto favorable emitido por parte del acreedor hipotecario, se celebra un acuerdo de pago bilateral con el mismo. En consecuencia, se declara el fracaso de la negociaciÃ³n con los demÃ¡s acreedores.",
          }),
        ],
        spacing: { before: 300, after: 300 },
      }));
    } else {
      sections.push(new Paragraph({
        children: [
          new TextRun({ text: `A partir de la votaciÃ³n se establece que entre el seÃ±or ` }),
          new TextRun({ text: deudorNombre.toUpperCase(), bold: true }),
          new TextRun({ text: `, y sus acreedores, ` }),
          new TextRun({ text: "HAY ACUERDO DE PAGO", bold: true }),
          new TextRun({ text: "." }),
        ],
        spacing: { before: 300, after: 300 },
      }));
    }

    // --- ACUERDO DE PAGO details ---
    sections.push(new Paragraph({
      children: [new TextRun({ text: "ACUERDO DE PAGO", bold: true, size: 24 })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 200 },
    }));

    if (tipoDoc === "ACUERDO DE PAGO BILATERAL Y FRACASO DEL TRAMITE") {
      const positiveHipotecario = payload.acreencias.find((a) => {
        const voto = normalizeVotoAcuerdo(a.voto);
        const nat = (a.naturaleza ?? "").toUpperCase();
        return voto === "POSITIVO" && nat.includes("HIPOTEC");
      });
      const positiveAny = payload.acreencias.find((a) => normalizeVotoAcuerdo(a.voto) === "POSITIVO");
      const acreedorBilateral = (positiveHipotecario?.acreedor ?? positiveAny?.acreedor ?? "[ACREEDOR]").trim();

      sections.push(new Paragraph({
        children: [
          new TextRun({ text: "Se deja constancia de que se celebrÃ³ un acuerdo bilateral con el acreedor hipotecario " }),
          new TextRun({ text: acreedorBilateral.toUpperCase(), bold: true }),
          new TextRun({ text: "." }),
        ],
        spacing: { after: 200 },
      }));

      sections.push(new Paragraph({
        children: [new TextRun({ text: "DATOS DEL DEUDOR", bold: true, size: 24 })],
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 200 },
      }));

      const deudorEmailFromAsistentes =
        payload.asistentes.find((a) => a.categoria === "Deudor" && isValidEmail(a.email))?.email?.trim()
        ?? "[CORREO ELECTRONICO]";

      sections.push(new Paragraph({
        children: [new TextRun({ text: `DEUDOR: ${deudorNombre.toUpperCase()}` })],
        spacing: { after: 80 },
      }));
      sections.push(new Paragraph({
        children: [new TextRun({ text: `C.C.\t${deudorId}` })],
        spacing: { after: 80 },
      }));
      sections.push(new Paragraph({
        children: [new TextRun({ text: `CORREO ELECTRONICO: ${deudorEmailFromAsistentes}.` })],
        spacing: { after: 200 },
      }));
    } else {
      if (hasPropuestaPagoData(payload)) {
        sections.push(new Paragraph({
          children: [
            new TextRun({
              text: "Conforme a la propuesta de pago aprobada, se pactan las siguientes condiciones:",
            }),
          ],
          spacing: { after: 180 },
        }));
        sections.push(...buildPropuestaPagoParagraphs(payload));
      } else {
        // One placeholder line per acreedor
        if (payload.acreencias.length > 0) {
          const uniqueAcreedoresAcuerdo = [...new Set(
            payload.acreencias.map((a) => a.acreedor?.trim() ?? "").filter(Boolean)
          )];
          uniqueAcreedoresAcuerdo.forEach((acreedor) => {
            sections.push(new Paragraph({
              children: [
                new TextRun({ text: acreedor.toUpperCase(), bold: true }),
                new TextRun({ text: ": [CONDICIONES DE PAGO]" }),
              ],
              spacing: { after: 150 },
            }));
          });
        } else {
          sections.push(new Paragraph({
            children: [new TextRun({ text: "[DETALLES DEL ACUERDO CON CADA ACREEDOR]" })],
            spacing: { after: 200 },
          }));
        }
      }
    }

    // --- PROYECCION DE PAGOS ---
    sections.push(new Paragraph({
      children: [new TextRun({ text: "PROYECCION DE PAGOS", bold: true, size: 24 })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 200 },
    }));

    if (excelDocData?.projectionTables && excelDocData.projectionTables.length > 0) {
      sections.push(new Paragraph({
        children: [
          new TextRun({
            text: `Tablas extraÃ­das del archivo Excel: ${excelDocData.source.drive_file_name}`,
            italics: true,
            size: 18,
          }),
        ],
        spacing: { after: 150 },
      }));

      excelDocData.projectionTables.forEach((table, index) => {
        sections.push(new Paragraph({
          children: [new TextRun({ text: table.title, bold: true, size: 20 })],
          spacing: { before: index === 0 ? 0 : 180, after: 100 },
        }));
        if (table.metadata && table.metadata.length > 0) {
          sections.push(createExcelMetadataTable(table.metadata));
          sections.push(new Paragraph({ children: [new TextRun({ text: "" })], spacing: { after: 100 } }));
        }
        sections.push(createExcelDocTable(table));
      });
      sections.push(new Paragraph({ children: [new TextRun({ text: "" })], spacing: { after: 220 } }));
    } else {
      sections.push(new Paragraph({
        children: [new TextRun({
          text: tipoDoc === "ACUERDO DE PAGO BILATERAL Y FRACASO DEL TRAMITE"
            ? "[PROYECCIÃ“N DE PAGOS]"
            : "[PROYECCIÃ“N DE PAGOS ENVIADA POR LA PARTE DEUDORA]",
        })],
        spacing: { after: 300 },
      }));
    }

    // --- OBSERVACIONES FINALES (Acuerdo de pago version) ---
    sections.push(new Paragraph({
      children: [new TextRun({ text: "OBSERVACIONES FINALES", bold: true, size: 24 })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 200 },
    }));

    sections.push(new Paragraph({
      children: [new TextRun({ text: "Conforme al artÃ­culo 553 de la Ley 1564 de 2012, el conciliador y los acreedores abajo firmantes dejan constancia en la presente acta que:" })],
      spacing: { after: 200 },
    }));

    const observacionesAcuerdo = (tipoDoc === "ACUERDO DE PAGO BILATERAL Y FRACASO DEL TRAMITE")
      ? [
          "Se deja constancia que los acreedores han sido debidamente comunicados del inicio del trÃ¡mite de negociaciÃ³n de deudas y que se les dieron las garantÃ­as procesales que la ley les otorga para esta clase de procedimientos. Cualquier decisiÃ³n adversa a sus intereses obedece a omisiones propias o decisiones tomadas por los jueces de conocimiento de las objeciones y/o controversias.",
          "El acuerdo bilateral ha sido celebrado dentro del tÃ©rmino previsto en la Ley, para la negociaciÃ³n de deudas.",
          "Conforme a lo dispuesto en el numeral 3 del art 554 del C G del P. se deja constancia que los acreedores condonaron el 100% de los intereses adeudados a la fecha de inicio del presente trÃ¡mite.",
          "El tÃ©rmino mÃ¡ximo para el cumplimiento general del acuerdo de pago bilateral serÃ¡ de ochenta (80) meses para crÃ©dito de tercera clase, sin perjuicio que el deudor pueda hacer pagos anticipados por oferta del acreedor.",
          votosAcuerdo.hasVotes
            ? `El acuerdo fue votado positivamente por el ${formatPercentage(votosAcuerdo.totals.POSITIVO)}.`
            : "[El acuerdo fue votado positivamente por el ___%.]",
          votosAcuerdo.hasVotes
            ? `El acuerdo tuvo votos por ausencia del ${formatPercentage(votosAcuerdo.totals.AUSENTE)}.`
            : "[El acuerdo tuvo votos por ausencia del ___%.]",
          votosAcuerdo.hasVotes
            ? `El acuerdo tuvo votos negativos del ${formatPercentage(votosAcuerdo.totals.NEGATIVO)}.`
            : "[El acuerdo tuvo votos negativos del ___%.]",
          votosAcuerdo.hasVotes
            ? `El acuerdo tuvo votos por se abstuvo del ${formatPercentage(votosAcuerdo.totals.ABSTENCION)}.`
            : "[El acuerdo tuvo votos por se abstuvo del ___%.]",
          "El presente acuerdo de pago no implica novaciÃ³n de las obligaciones, las cuales se mantendrÃ¡n incÃ³lumes frente a los tÃ­tulos de deuda primigenios.",
          "Se ha dado igual trato a los acreedores de una misma clase o grado.",
          `Se le advierte al deudor insolvente ${deudorNombre.toUpperCase()} de la obligaciÃ³n que ha adquirido con todos los acreedores que la apoyaron y sacaron adelante su propuesta, por ello debe cumplir en las condiciones en que hizo su propuesta de pago.`,
          "Los acreedores, podrÃ¡n ceder en cualquier momento y a cualquier tÃ­tulo los crÃ©ditos y se pondrÃ¡ al cesionario como sustituto del cedente. En todo caso, el acreedor cedente deberÃ¡ advertir al cesionario interesado sobre la existencia del presente acuerdo de pago y, por su parte, el cesionario deberÃ¡ aceptar expresamente las condiciones del presente acuerdo de pago y del crÃ©dito que adquiera. Para tal efecto, el cedente notificara al deudor para lo pertinente respecto de los pagos.",
          "El deudor puede hacer pagos anticipados o acogerse a rebajas o amnistÃ­as por oferta del acreedor, respetando la prelaciÃ³n legal o apartÃ¡ndose de ella con aceptaciÃ³n expresa del acreedor de prelaciÃ³n superior que no se le haya efectuado el pago total de la obligaciÃ³n.",
          "Se oficiarÃ¡ a los Juzgados si es el caso, informando el acuerdo de pago y a su vez se solicitarÃ¡ que los procesos ejecutivos deberÃ¡n continuar suspendidos, de conformidad con el art. 555 del C.G.P.",
          "Una vez se finalice los pagos a cada acreedor, el mismo acreedor se comprometen a entregar los respectivos paz y salvos y oficiar a los juzgados solicitando la terminaciÃ³n de los procesos por pago total.",
          "Se deja constancia que la audiencia se realizÃ³ de forma virtual y fue grabada.",
        ]
      : [
          "Se deja constancia que los acreedores han sido debidamente comunicados del inicio del trÃ¡mite de negociaciÃ³n de deudas y que se les dieron las garantÃ­as procesales que la ley les otorga para esta clase de procedimientos. Cualquier decisiÃ³n adversa a sus intereses obedece a omisiones propias o decisiones tomadas por los jueces de conocimiento de las objeciones y/o controversias.",
          "El acuerdo ha sido celebrado dentro del tÃ©rmino previsto en la Ley, para la negociaciÃ³n de deudas.",
          "Conforme a lo dispuesto en el numeral 3 del art 554 del C G del P. se deja constancia que los acreedores condonaron el 100% de los intereses adeudados a la fecha de inicio del presente tramite.",
          "El tÃ©rmino mÃ¡ximo para el cumplimiento general del acuerdo de pago serÃ¡ de sesenta 60 meses, sin perjuicio que el deudor pueda hacer pagos anticipados por oferta del acreedor.",
          votosAcuerdo.hasVotes
            ? `El acuerdo fue votado positivamente por el ${formatPercentage(votosAcuerdo.totals.POSITIVO)}.`
            : "[El acuerdo fue votado positivamente por el ___%.]",
          votosAcuerdo.hasVotes
            ? `El acuerdo tuvo votos por ausencia de acreedores en un ${formatPercentage(votosAcuerdo.totals.AUSENTE)}.`
            : "[El acuerdo tuvo votos por ausencia de acreedores en un ___%.]",
          "El acuerdo comprende la totalidad de los acreedores objeto de la negociaciÃ³n, conforme a la relaciÃ³n de acreedores y acreencias presentada por el deudor para efectos de la admisiÃ³n del trÃ¡mite de negociaciÃ³n de deudas.",
          "El presente acuerdo de pago no implica novaciÃ³n de las obligaciones, las cuales se mantendrÃ¡n incÃ³lumes frente a los tÃ­tulos de deuda primigenios.",
          "Se ha dado igual trato a los acreedores de una misma clase o grado.",
          `Se le advierte al deudor insolvente ${deudorNombre.toUpperCase()} de la obligaciÃ³n que ha adquirido con todos los acreedores que la apoyaron y sacaron adelante su propuesta, por ello debe cumplir en las condiciones en que hizo su propuesta de pago.`,
          "Los acreedores, podrÃ¡n ceder en cualquier momento y a cualquier tÃ­tulo los crÃ©ditos y se pondrÃ¡ al cesionario como sustituto del cedente. En todo caso, el acreedor cedente deberÃ¡ advertir al cesionario interesado sobre la existencia del presente acuerdo de pago y, por su parte, el cesionario deberÃ¡ aceptar expresamente las condiciones del presente acuerdo de pago y del crÃ©dito que adquiera. Para tal efecto, el cedente notificara al deudor para lo pertinente respecto de los pagos.",
          "El deudor puede hacer pagos anticipados o acogerse a rebajas o amnistÃ­as por oferta de los acreedores, respetando la prelaciÃ³n legal o apartÃ¡ndose de ella con aceptaciÃ³n expresa del acreedor de prelaciÃ³n superior que no se le haya efectuado el pago total de la obligaciÃ³n.",
          "Se oficiarÃ¡ a los Juzgados si es el caso, informando el acuerdo de pago y a su vez se solicitarÃ¡ que los procesos ejecutivos deberÃ¡n continuar suspendidos, de conformidad con el art. 555 del C.G.P.",
          "Se advierte al deudor que no podrÃ¡ disponer y/o enajenar los activos, hasta el cumplimiento total del acuerdo de pago.",
          "Una vez se finalice los pagos a cada acreedor, los mismos acreedores se comprometen a entregar los respectivos paz y salvos y oficiar a los juzgados solicitando la terminaciÃ³n de los procesos por pago total.",
          "Se deja constancia que la audiencia se realizÃ³ de forma virtual y fue grabada.",
        ];

    observacionesAcuerdo.forEach((item, idx) => {
      sections.push(new Paragraph({
        children: [new TextRun({ text: `${idx + 1}.\t${item}` })],
        spacing: { after: 120 },
        indent: { left: convertInchesToTwip(0.3) },
      }));
    });

    // Closing paragraph
    sections.push(new Paragraph({
      children: [
        new TextRun({
          text: `Por lo expuesto al cumplir el presente acuerdo de pago con las exigencias de la Ley 1564 de 2012 en lo relacionado con la negociaciÃ³n de deudas del deudor `,
        }),
        new TextRun({ text: deudorNombre.toUpperCase(), bold: true }),
        new TextRun({
          text: ` Teniendo en cuenta esta audiencia se llevÃ³ a cabo virtualmente; el conciliador actuando con el PRINCIPIO DE LA BUENA FE, previa grabaciÃ³n de toda la audiencia; donde constan las actuaciones y el acuerdo realizado, con la asistencia de la mayorÃ­a de los acreedores que votaron la fÃ³rmula de pago del deudor, se suscribe en seÃ±al de aceptaciÃ³n de lo acordado.`,
        }),
      ],
      spacing: { before: 200, after: 200 },
    }));

    sections.push(new Paragraph({
      children: [new TextRun({ text: "No siendo mÃ¡s el objeto de la presente, se suspende la presente diligencia" })],
      spacing: { after: 200 },
    }));

    // Confidentiality note
    sections.push(new Paragraph({
      children: [
        new TextRun({ text: "NOTA: ", bold: true }),
        new TextRun({
          text: `"AVISO DE CONFIDENCIALIDAD: Se les informa a las partes que les corresponde mantener reserva en general sobre la informaciÃ³n que reposa en este documento, a no ser que exista una autorizaciÃ³n explÃ­cita. De usar su contenido sin autorizaciÃ³n, podrÃ­a tener consecuencias legales como las contenidas en la Ley 1273 del 5 de enero de 2009 y todas las que le apliquen".`,
          italics: true,
        }),
      ],
      spacing: { after: 400 },
    }));

  } else if (tipoDoc === "ACTA FRACASO DEL TRAMITE") {
    const votos = computeVotosAcuerdo(payload.acreencias);

    // --- PROPUESTA DE PAGO ---
    sections.push(new Paragraph({
      children: [new TextRun({ text: "PROPUESTA DE PAGO", bold: true, size: 24 })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 200 },
    }));

    sections.push(new Paragraph({
      children: [
        new TextRun({
          text: "Acto seguido el/la suscrito(a) conciliador(a) continua con el desarrollo del numeral 5 y 6 del art. 550 del CGP, que estipula que el deudor haga una exposiciÃ³n de la propuesta de pago, para lo cual le concede el uso de la palabra el apoderado de la parte deudora quien indica:",
        }),
      ],
      spacing: { after: 200 },
    }));

    sections.push(...buildPropuestaPagoParagraphs(payload));

    // --- VOTACIÃ“N DEL ACUERDO ---
    sections.push(new Paragraph({
      children: [new TextRun({ text: "VOTACIÃ“N DEL ACUERDO", bold: true, size: 24 })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 200 },
    }));

    sections.push(new Paragraph({
      children: [
        new TextRun({
          text: "Teniendo en cuenta que es la segunda citaciÃ³n sin hacerse presente ningÃºn acreedor, se considera que no hay animo conciliatorio para un posible acuerdo de pago:",
        }),
      ],
      spacing: { after: 200 },
    }));

    if (excelDocData?.votingTable && excelDocData.votingTable.rows.length > 0) {
      sections.push(new Paragraph({
        children: [
          new TextRun({
            text: `Tabla de votaciÃ³n tomada del archivo Excel: ${excelDocData.source.drive_file_name}`,
            italics: true,
            size: 18,
          }),
        ],
        spacing: { after: 120 },
      }));
      sections.push(createExcelDocTable(excelDocData.votingTable));
    } else if (payload.acreencias.length > 0) {
      const votingHeaders = ["ACREEDOR", "CAPITAL", "%", "VOTACION"];
      const votingColWidths = [40, 25, 15, 20];
      const votingTableWidth = convertInchesToTwip(8.5 - 1.2);
      const votingColTwip = votingColWidths.map((pct) => Math.round((votingTableWidth * pct) / 100));
      const votingTwipSum = votingColTwip.reduce((a, v) => a + v, 0);
      if (votingColTwip.length > 0 && votingTwipSum !== votingTableWidth) {
        votingColTwip[votingColTwip.length - 1] += votingTableWidth - votingTwipSum;
      }

      const votingHeaderRow = new TableRow({
        children: votingHeaders.map(
          (h) =>
            new TableCell({
              children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20 })], alignment: AlignmentType.CENTER })],
              borders: tableBorders,
              shading: { fill: "E0E0E0" },
            })
        ),
      });

      let totalCapitalVoting = 0;
      payload.acreencias.forEach((a) => { totalCapitalVoting += a.capital ?? 0; });

      const votingBodyRows = payload.acreencias.map(
        (a) =>
          new TableRow({
            children: [
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: a.acreedor?.trim() || "â€”", size: 20 })] })],
                borders: tableBorders,
              }),
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: formatCurrency(a.capital), size: 20 })], alignment: AlignmentType.RIGHT })],
                borders: tableBorders,
              }),
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: formatPercentage(a.porcentaje), size: 20 })], alignment: AlignmentType.RIGHT })],
                borders: tableBorders,
              }),
              new TableCell({
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: votos.hasVotes ? (normalizeVotoAcuerdo(a.voto) ?? "AUSENTE") : "AUSENTE",
                        size: 20,
                      }),
                    ],
                    alignment: AlignmentType.CENTER,
                  }),
                ],
                borders: tableBorders,
              }),
            ],
          })
      );

      const votingTotalsRow = new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "TOTALES", bold: true, size: 20 })] })],
            borders: tableBorders,
            shading: { fill: "E0E0E0" },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: formatCurrency(totalCapitalVoting), bold: true, size: 20 })], alignment: AlignmentType.RIGHT })],
            borders: tableBorders,
            shading: { fill: "E0E0E0" },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "100,00%", bold: true, size: 20 })], alignment: AlignmentType.RIGHT })],
            borders: tableBorders,
            shading: { fill: "E0E0E0" },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "", size: 20 })] })],
            borders: tableBorders,
            shading: { fill: "E0E0E0" },
          }),
        ],
      });

      sections.push(new Table({
        rows: [votingHeaderRow, ...votingBodyRows, votingTotalsRow],
        width: { size: votingTableWidth, type: WidthType.DXA },
        columnWidths: votingColTwip,
        margins: { top: 40, bottom: 40, left: 40, right: 40 },
        layout: TableLayoutType.FIXED,
        alignment: AlignmentType.CENTER,
      }));
    }

    // --- RELACIÃ“N FINAL DE LOS VOTOS ---
    sections.push(new Paragraph({
      children: [new TextRun({ text: "RELACIÃ“N FINAL DE LOS VOTOS", bold: true, size: 24 })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 300, after: 200 },
    }));

    const voteHeaders = ["VOTOS POSITIVOS", "VOTOS NEGATIVOS", "VOTOS AUSENTES", "ABSTENCIÃ“N DE VOTO"];
    const voteColWidth = convertInchesToTwip(8.5 - 1.2);
    const voteColTwip = [25, 25, 25, 25].map((pct) => Math.round((voteColWidth * pct) / 100));
    const vtSum = voteColTwip.reduce((a, v) => a + v, 0);
    if (voteColTwip.length > 0 && vtSum !== voteColWidth) {
      voteColTwip[voteColTwip.length - 1] += voteColWidth - vtSum;
    }

    const totalPct = payload.acreencias.reduce((acc, a) => acc + (typeof a.porcentaje === "number" ? a.porcentaje : 0), 0);
    const totals = votos.hasVotes
      ? votos.totals
      : { POSITIVO: 0, NEGATIVO: 0, AUSENTE: totalPct, ABSTENCION: 0 };

    const finalVoteValues = [
      formatPercentage(totals.POSITIVO),
      formatPercentage(totals.NEGATIVO),
      formatPercentage(totals.AUSENTE),
      formatPercentage(totals.ABSTENCION),
    ];

    sections.push(new Table({
      rows: [
        new TableRow({
          children: voteHeaders.map(
            (h) =>
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20 })], alignment: AlignmentType.CENTER })],
                borders: tableBorders,
                shading: { fill: "E0E0E0" },
              })
          ),
        }),
        new TableRow({
          children: finalVoteValues.map(
            (v) =>
              new TableCell({
                children: [new Paragraph({ children: [new TextRun({ text: v, size: 20 })], alignment: AlignmentType.CENTER })],
                borders: tableBorders,
              })
          ),
        }),
      ],
      width: { size: voteColWidth, type: WidthType.DXA },
      columnWidths: voteColTwip,
      margins: { top: 40, bottom: 40, left: 40, right: 40 },
      layout: TableLayoutType.FIXED,
      alignment: AlignmentType.CENTER,
    }));

    sections.push(new Paragraph({
      children: [
        new TextRun({ text: "A partir de la votaciÃ³n se establece que entre " }),
        new TextRun({ text: deudorNombre.toUpperCase(), bold: true }),
        new TextRun({ text: " y sus acreedores, " }),
        new TextRun({ text: "NO HAY ACUERDO DE PAGO", bold: true }),
        new TextRun({ text: "." }),
      ],
      spacing: { before: 300, after: 300 },
    }));

    // --- OBSERVACIONES FINALES ---
    sections.push(new Paragraph({
      children: [new TextRun({ text: "OBSERVACIONES FINALES", bold: true, size: 24 })],
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 200 },
    }));

    sections.push(new Paragraph({
      children: [
        new TextRun({
          text: "Conforme al artÃ­culo 553 de la Ley 1564 de 2012, el conciliador y los acreedores abajo firmantes dejan constancia en la presente acta que:",
        }),
      ],
      spacing: { after: 200 },
    }));

    sections.push(new Paragraph({
      children: [
        new TextRun({
          text: `Por porcentaje de votaciÃ³n positiva fue del ${formatPercentage(totals.POSITIVO)} por lo tanto se declara fracasado el trÃ¡mite de insolvencia de persona natural no comerciante de `,
        }),
        new TextRun({ text: deudorNombre.toUpperCase(), bold: true }),
        new TextRun({
          text: ". Se remitirÃ¡ a liquidaciÃ³n patrimonial teniendo en cuenta lo que establece el CÃ³digo General del Proceso.",
        }),
      ],
      spacing: { after: 200 },
    }));

  } else {
    // Default content for ACTA AUDIENCIA, ACTA SUSPENSIÃ“N, etc.
    const observaciones = payload.observacionesFinales ||
      `Se deja constancia de que la apoderada del deudor procediÃ³ a verbalizar la propuesta de pago, frente a lo cual los acreedores asistentes expusieron las polÃ­ticas aplicables de cada una de sus entidades. En razÃ³n de lo anterior, la apoderada del deudor solicitÃ³ la suspensiÃ³n de la presente diligencia, con el fin de informar a su representado las observaciones efectuadas a la propuesta y evaluar la posibilidad de modificarla. En caso de realizarse ajustes, la nueva propuesta actualizada deberÃ¡ ser remitida a este centro de conciliaciÃ³n, con copia a todos los acreedores. Finalmente se deja constancia de que se encuentra precluida la etapa de relaciÃ³n de acreencias.`;

    sections.push(new Paragraph({
      children: [new TextRun({ text: observaciones })],
      spacing: { after: 200 },
    }));

    sections.push(new Paragraph({
      children: [
        new TextRun({ text: `Teniendo en cuenta lo anterior y que no se han presentes los demÃ¡s acreedores. El suscrito conciliador informa que se hace necesario suspender la presente audiencia. Fijando nueva fecha para el dÃ­a ` }),
        new TextRun({ text: proximaFecha, bold: true }),
        new TextRun({ text: ` a las ` }),
        new TextRun({ text: proximaHora, bold: true }),
        new TextRun({ text: `.` }),
      ],
      spacing: { after: 400 },
    }));
  }

  // Signature
  sections.push(new Paragraph({
    children: [new TextRun({ text: "Atentamente," })],
    spacing: { before: 300, after: 400 },
  }));

  if (operadorSignatureImage) {
    sections.push(new Paragraph({
      children: [
        new ImageRun({
          type: operadorSignatureImage.type,
          data: operadorSignatureImage.data,
          transformation: { width: 190, height: 70 },
        }),
      ],
      spacing: { after: 140 },
    }));
  } else {
    sections.push(new Paragraph({
      children: [new TextRun({ text: "\n\n\n\n" })],
    }));
  }

  sections.push(new Paragraph({
    children: [new TextRun({ text: operadorNombre.toUpperCase(), bold: true })],
    alignment: AlignmentType.LEFT,
  }));

  sections.push(new Paragraph({
    children: [
      new TextRun({ text: "Conciliador Extrajudicial en Derecho y Operador en Insolvencias" }),
      new TextRun({ text: `C. C. No. ${operadorId}`, break: 1 }),
    ],
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
      top: convertInchesToTwip(1.15),
      right: convertInchesToTwip(0.6),
      bottom: convertInchesToTwip(0.6),
      left: convertInchesToTwip(0.6),
      header: convertInchesToTwip(0.2),
    },
    size: {
      width: convertInchesToTwip(8.5),
      height: convertInchesToTwip(11),
      orientation: PageOrientation.PORTRAIT,
    },
  };

  const landscapePage = {
    margin: {
      top: convertInchesToTwip(1.15),
      right: convertInchesToTwip(0.6),
      bottom: convertInchesToTwip(0.6),
      left: convertInchesToTwip(0.6),
      header: convertInchesToTwip(0.2),
    },
    size: {
      width: convertInchesToTwip(11),
      height: convertInchesToTwip(8.5),
      orientation: PageOrientation.LANDSCAPE,
    },
  };

  const docSections: ISectionOptions[] = [];
  docSections.push(buildSection(portraitPage, docHeader, portraitBefore));
  if (landscapeAcreencias.length > 0) {
    docSections.push(buildSection(landscapePage, docHeader, landscapeAcreencias));
  }
  if (portraitAfter.length > 0) {
    docSections.push(buildSection(portraitPage, docHeader, portraitAfter));
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

    const tipoDocLabel = payload.tipoDocumento || "Acta Audiencia";
    const fileName = `${payload.numeroProceso?.trim() || payload.procesoId} - ${payload.fecha} - ${
      safeTitle || tipoDocLabel
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

    const actaId = await saveActaAudienciaSnapshot({ payload, uploaded });

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
      actaId,
      apoderadoEmails: uniqueEmails,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: "Failed to terminar audiencia.", detail: toErrorMessage(e) },
      { status: 500 }
    );
  }
}
