import { Suspense } from "react";
import type { Metadata } from "next";

import RegistroForm from "@/components/registro-form";

type RegistroPageProps = {
  searchParams?: {
    procesoId?: string;
    tipo?: "deudores" | "acreedores" | "deudor" | "acreedor";
  } | Promise<{
    procesoId?: string;
    tipo?: "deudores" | "acreedores" | "deudor" | "acreedor";
  }>;
};

export const metadata: Metadata = {
  title: "Registro de procesos | AutoActas",
  description: "Registra o edita procesos judiciales desde un formulario dedicado.",
};

export default async function RegistroPage({ searchParams }: RegistroPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const procesoId = resolvedSearchParams?.procesoId?.trim() || null;
  const tipo = resolvedSearchParams?.tipo?.toLowerCase();
  const focusSection =
    tipo === "acreedores" || tipo === "acreedor"
      ? "acreedores"
      : tipo === "deudores" || tipo === "deudor"
      ? "deudores"
      : undefined;

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10 sm:px-8">
      <Suspense
        fallback={
          <div className="text-sm text-zinc-500">Cargando formulario...</div>
        }
      >
        <RegistroForm initialProcesoId={procesoId} focusSection={focusSection} />
      </Suspense>
    </main>
  );
}
