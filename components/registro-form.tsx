"use client";

import { useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import ProcesoForm from "@/components/proceso-form";
import { useProcesoForm } from "@/lib/hooks/useProcesoForm";

type FocusSection = "deudores" | "acreedores";

type RegistroFormProps = {
  initialProcesoId?: string | null;
  focusSection?: FocusSection;
};

export default function RegistroForm({ initialProcesoId, focusSection }: RegistroFormProps) {
  const normalizedProcesoId = initialProcesoId?.trim() || undefined;
  const searchParams = useSearchParams();
  const queryTipo = searchParams.get("tipo")?.toLowerCase();
  const apoderadoIdParam = searchParams.get("apoderadoId")?.trim();
  const apoderadoNameParam = searchParams.get("apoderadoName")?.trim();

  const resolvedFocusSection = useMemo<FocusSection | undefined>(() => {
    if (queryTipo === "acreedor" || queryTipo === "acreedores") {
      return "acreedores";
    }
    if (queryTipo === "deudor" || queryTipo === "deudores") {
      return "deudores";
    }
    return focusSection;
  }, [focusSection, queryTipo]);

  const normalizedFocusSection =
    resolvedFocusSection === "acreedores"
      ? "acreedores"
      : resolvedFocusSection === "deudores"
      ? "deudores"
      : undefined;

  const form = useProcesoForm({ initialProcesoId: normalizedProcesoId });
  const modalCreationRef = useRef<FocusSection | null>(null);
  const {
    acreedoresForm,
    deudoresForm,
    apoderados,
    apoderadoModalOpen,
    actualizarAcreedorRow,
    actualizarDeudorRow,
    setApoderadoForm,
    abrirModalApoderado,
  } = form;

  const title =
    normalizedFocusSection === "acreedores"
      ? "Registrar acreedor"
      : normalizedFocusSection === "deudores"
      ? "Registrar deudor"
      : normalizedProcesoId
      ? "Gestionar relaciones del proceso"
      : "Agregar deudores y acreedores";
  const subtitle =
    normalizedFocusSection === "acreedores"
      ? "Añade un acreedor y su información antes de guardarlo en el proceso."
      : normalizedFocusSection === "deudores"
      ? "Añade un deudor y su apoderado para continuar."
      : normalizedProcesoId
      ? "Actualiza los apoderados, deudores y acreedores asociados al proceso seleccionado."
      : "Registra nuevos deudores y acreedores; el formulario general está disponible en Procesos.";

  const tipoParamHint =
    normalizedFocusSection === "acreedores"
      ? "acreedor"
      : normalizedFocusSection === "deudores"
      ? "deudor"
      : undefined;

  const submitLabel =
    normalizedFocusSection === "acreedores"
      ? "Agregar acreedor"
      : normalizedFocusSection === "deudores"
      ? "Agregar deudor"
      : undefined;

  const requiresApoderadoCreation = useMemo(() => {
    if (!normalizedFocusSection) {
      return false;
    }
    if (!apoderadoIdParam && !apoderadoNameParam) {
      return false;
    }

    const filas =
      normalizedFocusSection === "acreedores" ? acreedoresForm : deudoresForm;
    const primerFila = filas[0];
    if (!primerFila) {
      return false;
    }

    const matchById = apoderadoIdParam
      ? apoderados.find((ap) => ap.id === apoderadoIdParam)
      : undefined;
    const matchByName = apoderadoNameParam
      ? apoderados.find(
          (ap) => ap.nombre?.trim().toLowerCase() === apoderadoNameParam.toLowerCase(),
        )
      : undefined;

    const targetApoderado = matchById ?? matchByName;
    return Boolean(!targetApoderado && (apoderadoIdParam || apoderadoNameParam));
  }, [
    normalizedFocusSection,
    apoderadoIdParam,
    apoderadoNameParam,
    apoderados,
    acreedoresForm,
    deudoresForm,
  ]);

  const submitDisabledReason =
    requiresApoderadoCreation && normalizedFocusSection
      ? `Debes crear al apoderado ${normalizedFocusSection === "acreedores" ? "acreedor" : "deudor"} antes de continuar.`
      : undefined;

  useEffect(() => {
    if (!normalizedFocusSection) {
      modalCreationRef.current = null;
      return;
    }

    if (!apoderadoIdParam && !apoderadoNameParam) {
      modalCreationRef.current = null;
      return;
    }

    const isAcreedor = normalizedFocusSection === "acreedores";
    const filas = isAcreedor ? acreedoresForm : deudoresForm;
    const primerFila = filas[0];
    if (!primerFila) {
      return;
    }

    const matchById = apoderadoIdParam
      ? apoderados.find((ap) => ap.id === apoderadoIdParam)
      : undefined;
    const matchByName = apoderadoNameParam
      ? apoderados.find(
          (ap) => ap.nombre?.trim().toLowerCase() === apoderadoNameParam.toLowerCase(),
        )
      : undefined;

    const targetApoderado = matchById ?? matchByName;
    const needsCreation = Boolean(!targetApoderado && (apoderadoIdParam || apoderadoNameParam));

    const patch = {
      apoderadoId: targetApoderado?.id ?? apoderadoIdParam ?? primerFila.apoderadoId,
      apoderadoNombre:
        targetApoderado?.nombre ??
        (apoderadoNameParam ?? primerFila.apoderadoNombre),
    };

    if (!patch.apoderadoId && !patch.apoderadoNombre) {
      if (!needsCreation) {
        modalCreationRef.current = null;
      }
      return;
    }

    const rowUpdated =
      primerFila.apoderadoId !== patch.apoderadoId ||
      primerFila.apoderadoNombre !== patch.apoderadoNombre;

    if (rowUpdated) {
      if (isAcreedor) {
        actualizarAcreedorRow(primerFila.id, patch);
      } else {
        actualizarDeudorRow(primerFila.id, patch);
      }
    }

    if (
      needsCreation &&
      !apoderadoModalOpen &&
      modalCreationRef.current !== normalizedFocusSection
    ) {
      modalCreationRef.current = normalizedFocusSection;
      setApoderadoForm((prev) => ({
        ...prev,
        nombre: apoderadoNameParam ?? patch.apoderadoNombre ?? prev.nombre,
        identificacion: "",
        email: "",
        telefono: "",
        direccion: "",
      }));
      abrirModalApoderado({
        tipo: isAcreedor ? "acreedor" : "deudor",
        id: primerFila.id,
      });
    }

    if (!needsCreation) {
      modalCreationRef.current = null;
    }
  }, [
    normalizedFocusSection,
    apoderadoIdParam,
    apoderadoNameParam,
    apoderados,
    acreedoresForm,
    deudoresForm,
    actualizarAcreedorRow,
    actualizarDeudorRow,
    apoderadoModalOpen,
    setApoderadoForm,
    abrirModalApoderado,
  ]);

  return (
    <section className="rounded-3xl border border-zinc-200 bg-white/80 p-6 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-8">
      <div className="mb-6 space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.4em] text-zinc-500 dark:text-zinc-400">
          Registro
        </p>
        <h1 className="text-3xl font-semibold text-zinc-950 dark:text-zinc-50">{title}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-300">{subtitle}</p>
        {normalizedProcesoId && (
          <p className="text-sm font-mono text-xs text-indigo-700 dark:text-indigo-300">
            Proceso ID: <span className="font-semibold text-zinc-950 dark:text-zinc-50">{normalizedProcesoId}</span>
          </p>
        )}
        {normalizedFocusSection && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Puedes alternar entre acreedores o deudores usando <code>?tipo={tipoParamHint ?? normalizedFocusSection}</code> en la URL.
          </p>
        )}
        <div className="flex flex-wrap gap-2 pt-2">
          <Link
            href="/procesos"
            className="inline-flex items-center justify-center rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-xs font-semibold text-zinc-700 shadow-sm transition hover:border-zinc-900 hover:text-zinc-900 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:border-white dark:hover:text-white"
          >
            Ver procesos
          </Link>
          <Link
            href="/calendario"
            className="inline-flex items-center justify-center rounded-full border border-indigo-200 bg-indigo-100/60 px-4 py-2 text-xs font-semibold text-indigo-700 shadow-sm transition hover:bg-indigo-200/70 dark:border-indigo-400/60 dark:bg-indigo-500/10 dark:text-indigo-50 dark:hover:border-indigo-200 dark:hover:bg-indigo-500/20"
          >
            Ir al calendario
          </Link>
        </div>
      </div>
      <ProcesoForm
        form={form}
        showGeneralInfo={false}
        focusSection={normalizedFocusSection}
        submitLabel={submitLabel}
        disableSubmit={requiresApoderadoCreation}
        submitDisabledReason={submitDisabledReason}
      />
    </section>
  );
}
