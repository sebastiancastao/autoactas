"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  HeadingLevel,
  AlignmentType,
} from "docx";

import { getProcesoWithRelations, getProcesos } from "@/lib/api/proceso";
import type {
  Acreedor,
  Apoderado,
  Deudor,
  Progreso,
  Proceso,
} from "@/lib/database.types";

type ProcesoWithRelations = Proceso & {
  deudores?: Deudor[];
  acreedores?: Acreedor[];
  progreso?: Progreso | null;
  apoderados?: Apoderado[];
};

const formatDateLabel = (value?: string | null) => {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
};

const capitalize = (value?: string | null) => {
  if (!value) return "—";
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const progressSummary = (progreso?: Progreso | null) => {
  if (!progreso) return "Sin registro de progreso";
  const parts: string[] = [];
  parts.push(capitalize(progreso.estado));
  if (typeof progreso.numero_audiencias === "number") {
    parts.push(`Audiencias: ${progreso.numero_audiencias}`);
  }
  if (progreso.fecha_procesos_real) {
    parts.push(`Inicio real: ${formatDateLabel(progreso.fecha_procesos_real)}`);
  }
  if (progreso.fecha_finalizacion) {
    parts.push(`Finalización: ${formatDateLabel(progreso.fecha_finalizacion)}`);
  }
  return parts.join(" · ");
};

const formatCurrency = (value?: number | null) => {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("es-CO", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
};

const formatContactLine = (telefono?: string | null, email?: string | null) => {
  const parts = [telefono?.trim(), email?.trim()].filter(Boolean);
  return parts.length ? parts.join(" / ") : "—";
};

const createInfoParagraphs = (rows: { label: string; value: string }[]) =>
  rows.map(
    (row) =>
      new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({ text: `${row.label}: `, bold: true }),
          new TextRun(row.value || "—"),
        ],
      }),
  );

const createDataTable = (headers: string[], rows: string[][]) => {
  const headerRow = new TableRow({
    children: headers.map((header) =>
      new TableCell({
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: header, bold: true }),
            ],
          }),
        ],
      }),
    ),
  });

  const bodyRows = rows.map((row) =>
    new TableRow({
      children: row.map((cell) =>
        new TableCell({
          children: [new Paragraph(cell || "—")],
        }),
      ),
    }),
  );

  return new Table({
    rows: [headerRow, ...bodyRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
};

const buildProcesoDocument = async (proceso: ProcesoWithRelations) => {
  const generalInfo = [
    { label: "Número de proceso", value: proceso.numero_proceso || "—" },
    { label: "Fecha de radicación", value: formatDateLabel(proceso.fecha_procesos) },
    { label: "Estado", value: proceso.estado ? capitalize(proceso.estado) : "—" },
    { label: "Tipo", value: proceso.tipo_proceso || "—" },
    { label: "Juzgado", value: proceso.juzgado || "—" },
    {
      label: "Resumen de progreso",
      value: progressSummary(proceso.progreso),
    },
  ];

  if (proceso.progreso?.observaciones) {
    generalInfo.push({ label: "Observaciones", value: proceso.progreso.observaciones });
  }

  const descriptionParagraphs: Paragraph[] = [];
  if (proceso.descripcion) {
    descriptionParagraphs.push(
      new Paragraph({
        spacing: { before: 160, after: 120 },
        children: [
          new TextRun({ text: "Descripción general", bold: true }),
        ],
      }),
      new Paragraph({ text: proceso.descripcion, spacing: { after: 120 } }),
    );
  }

  const deudorRows = (proceso.deudores ?? []).map((deudor) => [
    deudor.nombre,
    [deudor.identificacion, deudor.tipo_identificacion].filter(Boolean).join(" ") || "—",
    formatContactLine(deudor.telefono, deudor.email),
  ]);

  const acreedorRows = (proceso.acreedores ?? []).map((acreedor) => [
    acreedor.nombre,
    [acreedor.identificacion, acreedor.tipo_identificacion].filter(Boolean).join(" ") || "—",
    `${formatCurrency(acreedor.monto_acreencia)} • ${acreedor.tipo_acreencia || "—"}`,
  ]);

  const apoderados = proceso.apoderados ?? [];

  const sections: (Paragraph | Table)[] = [
    new Paragraph({
      text: `Proceso ${proceso.numero_proceso ?? proceso.id}`,
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
    }),
    new Paragraph({
      text: "Resumen generado por AutoActas",
      spacing: { after: 180 },
      alignment: AlignmentType.CENTER,
    }),
    ...createInfoParagraphs(generalInfo),
    ...descriptionParagraphs,
  ];

  sections.push(
    new Paragraph({
      text: "Deudores",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 200, after: 120 },
    }),
  );
  if (deudorRows.length) {
    sections.push(createDataTable(["Nombre", "Identificación", "Contacto"], deudorRows));
  } else {
    sections.push(
      new Paragraph({
        text: "No hay deudores registrados para este proceso.",
        spacing: { after: 120 },
      }),
    );
  }

  sections.push(
    new Paragraph({
      text: "Acreedores",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 220, after: 120 },
    }),
  );
  if (acreedorRows.length) {
    sections.push(createDataTable(["Nombre", "Identificación", "Monto y tipo"], acreedorRows));
  } else {
    sections.push(
      new Paragraph({
        text: "No hay acreedores registrados para este proceso.",
        spacing: { after: 120 },
      }),
    );
  }

  sections.push(
    new Paragraph({
      text: "Apoderados",
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 220, after: 120 },
    }),
  );
  if (apoderados.length) {
    apoderados.forEach((apoderado) => {
      sections.push(
        new Paragraph({
          children: [
            new TextRun({ text: apoderado.nombre, bold: true }),
            new TextRun({ text: ` (${apoderado.identificacion})` }),
            new TextRun({ text: ` — ${formatContactLine(apoderado.telefono, apoderado.email)}` }),
          ],
          spacing: { after: 100 },
        }),
      );
    });
  } else {
    sections.push(
      new Paragraph({
        text: "No hay apoderados asociados.",
        spacing: { after: 120 },
      }),
    );
  }

  const document = new Document({
    sections: [{ children: sections }],
  });
  const blob = await Packer.toBlob(document);
  const filename = `proceso-${(proceso.numero_proceso || proceso.id)
    .replace(/\s+/g, "_")
    .toLowerCase()}.docx`;

  return { blob, filename };
};

export default function ExportarProcesoWordPage() {
  const [procesos, setProcesos] = useState<Proceso[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedProcesoId, setSelectedProcesoId] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<ProcesoWithRelations | null>(null);
  const [detalleLoading, setDetalleLoading] = useState(false);
  const [detalleError, setDetalleError] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);
  const [generacionError, setGeneracionError] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    async function cargar() {
      setListLoading(true);
      setListError(null);
      try {
        const datos = await getProcesos();
        if (!activo) return;
        const lista = datos ?? [];
        setProcesos(lista);
        setSelectedProcesoId((actual) => actual ?? lista[0]?.id ?? null);
      } catch (error) {
        console.error("Error cargando procesos para exportación:", error);
        if (activo) {
          setListError("No se pudo cargar la lista de procesos.");
        }
      } finally {
        if (activo) {
          setListLoading(false);
        }
      }
    }
    cargar();
    return () => {
      activo = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedProcesoId) {
      setDetalle(null);
      setDetalleError(null);
      setDetalleLoading(false);
      return;
    }

    let activo = true;
    async function cargarDetalle() {
      setDetalleLoading(true);
      setDetalleError(null);
      setDetalle(null);
      try {
        const procesoId = selectedProcesoId;
        if (!procesoId) return;
        const datos = await getProcesoWithRelations(procesoId);
        if (!activo) return;
        setDetalle(datos ?? null);
      } catch (error) {
        console.error("Error cargando detalle del proceso:", error);
        if (activo) {
          setDetalleError("No se pudo cargar el detalle del proceso.");
        }
      } finally {
        if (activo) {
          setDetalleLoading(false);
        }
      }
    }

    cargarDetalle();
    return () => {
      activo = false;
    };
  }, [selectedProcesoId]);

  const infoRows = useMemo(() => {
    if (!detalle) return [];
    const rows = [
      { label: "Número", value: detalle.numero_proceso ?? "—" },
      { label: "Juzgado", value: detalle.juzgado || "—" },
      { label: "Fecha", value: formatDateLabel(detalle.fecha_procesos) },
      { label: "Estado", value: detalle.estado ? capitalize(detalle.estado) : "—" },
      { label: "Tipo", value: detalle.tipo_proceso || "—" },
      { label: "Progreso", value: progressSummary(detalle.progreso) },
    ];
    if (detalle.progreso?.observaciones) {
      rows.push({ label: "Observaciones", value: detalle.progreso.observaciones });
    }
    return rows;
  }, [detalle]);

  const statCards = useMemo(() => {
    if (!detalle) return [];
    return [
      {
        label: "Deudores",
        value: detalle.deudores?.length ?? 0,
      },
      {
        label: "Acreedores",
        value: detalle.acreedores?.length ?? 0,
      },
      {
        label: "Apoderados",
        value: detalle.apoderados?.length ?? 0,
      },
      {
        label: "Audiencias",
        value: detalle.progreso?.numero_audiencias ?? 0,
      },
    ];
  }, [detalle]);

  const descargarDocumento = useCallback(async () => {
    if (!detalle) return;
    setGeneracionError(null);
    setGenerando(true);
    try {
      const { blob, filename } = await buildProcesoDocument(detalle);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error generando Word:", error);
      const mensaje = error instanceof Error ? error.message : "No se pudo generar el documento.";
      setGeneracionError(mensaje);
    } finally {
      setGenerando(false);
    }
  }, [detalle]);

  return (
    <main className="min-h-screen bg-zinc-50 px-5 pb-10 pt-8 text-zinc-950 dark:bg-black dark:text-zinc-50">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <header className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <Link
              href="/procesos"
              className="text-indigo-600 underline-offset-4 transition hover:text-indigo-400 dark:text-indigo-300"
            >
              ↩ Procesos
            </Link>
            <span>Exportar Word</span>
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.4em] text-zinc-500 dark:text-zinc-400">
              Documentos
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">Exportar proceso a Word</h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-300">
              Selecciona un proceso y descarga un resumen insertable en actas judiciales.
            </p>
          </div>
        </header>

        <section className="rounded-3xl border border-zinc-200 bg-white/90 p-6 shadow-[0_25px_60px_-25px_rgba(15,23,42,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/5">
          <div className="space-y-4">
            <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400" htmlFor="proceso-select">
              Proceso
            </label>
            {listLoading ? (
              <p className="text-sm text-zinc-500">Cargando procesos...</p>
            ) : (
              <select
                id="proceso-select"
                value={selectedProcesoId ?? ""}
                onChange={(event) => setSelectedProcesoId(event.target.value || null)}
                className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none dark:border-white/10 dark:bg-black/10"
              >
                <option value="">Selecciona un proceso</option>
                {procesos.map((proceso) => (
                  <option key={proceso.id} value={proceso.id}>
                    {proceso.numero_proceso} — {proceso.juzgado || "(sin juzgado)"}
                  </option>
                ))}
              </select>
            )}
            {listError && <p className="text-sm text-red-600">{listError}</p>}
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {statCards.length ? (
              statCards.map((card) => (
                <div
                  key={card.label}
                  className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 text-center text-sm font-semibold text-zinc-700 shadow-sm dark:border-white/10 dark:bg-white/10 dark:text-zinc-100"
                >
                  <p className="text-xs uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400">
                    {card.label}
                  </p>
                  <p className="mt-2 text-2xl text-zinc-900 dark:text-white">{card.value}</p>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 text-center text-sm text-zinc-500 dark:border-white/10 dark:bg-white/10 dark:text-zinc-400">
                Selecciona un proceso para ver métricas.
              </div>
            )}
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={descargarDocumento}
              disabled={!detalle || detalleLoading || generando}
              className="inline-flex flex-1 items-center justify-center rounded-2xl border border-transparent bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500"
            >
              {generando ? "Generando documento…" : "Descargar Word"}
            </button>
            {detalle && (
              <p className="text-xs text-zinc-500">
                El archivo incluirá la información registrada en {detalle.numero_proceso}.
              </p>
            )}
          </div>
          {generacionError && <p className="mt-2 text-xs text-red-600">{generacionError}</p>}
        </section>

        <section className="space-y-6 rounded-3xl border border-zinc-200 bg-white/90 p-6 shadow-[0_25px_60px_-25px_rgba(15,23,42,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/5">
          {detalleLoading ? (
            <p className="text-sm text-zinc-500">Cargando detalle del proceso…</p>
          ) : detalleError ? (
            <p className="text-sm text-red-600">{detalleError}</p>
          ) : detalle ? (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold">Información general</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {infoRows.map((row) => (
                    <div key={row.label} className="text-sm">
                      <p className="text-xs uppercase tracking-[0.2em] text-zinc-500 dark:text-zinc-400">
                        {row.label}
                      </p>
                      <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-50">
                        {row.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-white/10 dark:bg-white/5">
                  <h3 className="text-sm font-semibold text-zinc-700">Deudores</h3>
                  {detalle.deudores?.length ? (
                    <ul className="mt-3 space-y-3 text-sm text-zinc-600 dark:text-zinc-300">
                      {detalle.deudores.map((deudor) => (
                        <li key={deudor.id}>
                          <p className="font-semibold text-zinc-900 dark:text-zinc-100">{deudor.nombre}</p>
                          <p className="text-xs text-zinc-500">
                            {deudor.identificacion} — {deudor.tipo_identificacion || "Tipo no definido"}
                          </p>
                          <p className="text-xs text-zinc-500" aria-label="Contacto">
                            {formatContactLine(deudor.telefono, deudor.email)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-zinc-500">Sin deudores asociados.</p>
                  )}
                </div>
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-white/10 dark:bg-white/5">
                  <h3 className="text-sm font-semibold text-zinc-700">Acreedores</h3>
                  {detalle.acreedores?.length ? (
                    <ul className="mt-3 space-y-3 text-sm text-zinc-600 dark:text-zinc-300">
                      {detalle.acreedores.map((acreedor) => (
                        <li key={acreedor.id}>
                          <p className="font-semibold text-zinc-900 dark:text-zinc-100">{acreedor.nombre}</p>
                          <p className="text-xs text-zinc-500">
                            {acreedor.identificacion} — {acreedor.tipo_identificacion || "Tipo no definido"}
                          </p>
                          <p className="text-xs text-zinc-500">
                            {formatCurrency(acreedor.monto_acreencia)} • {acreedor.tipo_acreencia || "—"}
                          </p>
                          <p className="text-xs text-zinc-500" aria-label="Contacto">
                            {formatContactLine(acreedor.telefono, acreedor.email)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-zinc-500">Sin acreedores asociados.</p>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-white/10 dark:bg-white/5">
                <h3 className="text-sm font-semibold text-zinc-700">Apoderados</h3>
                {detalle.apoderados?.length ? (
                  <ul className="mt-3 space-y-3 text-sm text-zinc-600 dark:text-zinc-300">
                    {detalle.apoderados.map((apoderado) => (
                      <li key={apoderado.id}>
                        <p className="font-semibold text-zinc-900 dark:text-zinc-100">{apoderado.nombre}</p>
                        <p className="text-xs text-zinc-500">{apoderado.identificacion}</p>
                        <p className="text-xs text-zinc-500">
                          {formatContactLine(apoderado.telefono, apoderado.email)}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-zinc-500">Sin apoderados registrados.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Selecciona un proceso para ver el detalle.</p>
          )}
        </section>
      </div>
    </main>
  );
}
