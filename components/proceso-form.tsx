"use client";
import type { ProcesoFormContext } from "@/lib/hooks/useProcesoForm";

type FocusSection = "deudores" | "acreedores";

type ProcesoFormProps = {
  form: ProcesoFormContext;
  showGeneralInfo?: boolean;
  focusSection?: FocusSection;
  submitLabel?: string;
  disableSubmit?: boolean;
  submitDisabledReason?: string;
};

const formatMontoInputValue = (value: number) =>
  Number.isFinite(value) ? (Number.isInteger(value) ? value.toString() : value.toFixed(2)) : "";

const formatMontoLabel = (value: number) =>
  Number.isFinite(value)
    ? value.toLocaleString("es-CO", {
        minimumFractionDigits: value % 1 === 0 ? 0 : 2,
        maximumFractionDigits: 2,
      })
    : "0";

const obligationAmountFields = ["capital", "interesCte", "interesMora", "otros"] as const;

const parseObligationValue = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const computeObligacionTotal = (obligacion: {
  capital: string;
  interesCte: string;
  interesMora: string;
  otros: string;
}) => obligationAmountFields.reduce((acc, field) => acc + parseObligationValue(obligacion[field]), 0);

const hasObligacionAmounts = (obligacion: {
  capital: string;
  interesCte: string;
  interesMora: string;
  otros: string;
}) =>
  obligationAmountFields.some((field) => obligacion[field].trim() !== "");

export default function ProcesoForm({
  form,
  showGeneralInfo = true,
  focusSection,
  submitLabel,
  disableSubmit = false,
  submitDisabledReason,
}: ProcesoFormProps) {
  const {
    error,
    exito,
    guardando,
    numeroProceso,
    setNumeroProceso,
    fechaprocesos,
    setFechaprocesos,
    estado,
    setEstado,
    tipoProceso,
    setTipoProceso,
    juzgado,
    setJuzgado,
    descripcion,
    setDescripcion,
    deudoresForm,
    actualizarDeudorRow,
    eliminarDeudorRow,
    selectedDeudorId,
    setSelectedDeudorId,
    acreedoresForm,
    actualizarAcreedorRow,
    eliminarAcreedorRow,
    agregarObligacionRow,
    actualizarObligacionRow,
    eliminarObligacionRow,
    selectedAcreedorId,
    setSelectedAcreedorId,
    apoderados,
    apoderadoModalOpen,
    apoderadoForm,
    setApoderadoForm,
    apoderadoGuardando,
    guardarApoderado,
    abrirModalApoderado,
    cerrarModalApoderado,
    handleRowApoderadoInput,
    cargandoDetalle,
    editingProcesoId,
    handleSubmit,
    resetFormFields,
  } = form;

  const focusSectionNormalized =
    focusSection === "acreedores"
      ? "acreedores"
      : focusSection === "deudores"
      ? "deudores"
      : undefined;

  const shouldShowDeudoresSection =
    focusSectionNormalized ? focusSectionNormalized === "deudores" : true;
  const shouldShowAcreedoresSection =
    focusSectionNormalized ? focusSectionNormalized === "acreedores" : true;

  const renderAcreedorRow = (
    acreedor: (typeof acreedoresForm)[number],
    index: number,
  ) => {
    const totalObligaciones = acreedor.obligaciones.reduce(
      (acc, obligacion) => acc + computeObligacionTotal(obligacion),
      0,
    );
    const tieneMontoCalculado = acreedor.obligaciones.some(hasObligacionAmounts);
    const montoInputValue =
      tieneMontoCalculado && Number.isFinite(totalObligaciones)
        ? formatMontoInputValue(totalObligaciones)
        : acreedor.monto;
    const totalObligacionesLabel = formatMontoLabel(totalObligaciones);

    return (
      <div
        key={acreedor.id}
        className="rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-sm transition hover:shadow-md dark:border-white/10 dark:bg-white/5"
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
            Acreedor {index + 1}
          </p>
          <button
            type="button"
            onClick={() => eliminarAcreedorRow(acreedor.id)}
            disabled={acreedoresForm.length === 1}
            className="rounded-full px-3 py-1 text-sm text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
            title={
              acreedoresForm.length === 1 ? "Debe quedar al menos un acreedor" : "Eliminar"
            }
          >
            Eliminar
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
              Nombre
            </label>
            <input
              value={acreedor.nombre}
              onChange={(e) => actualizarAcreedorRow(acreedor.id, { nombre: e.target.value })}
              placeholder="Ej: Banco ABC"
              className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
              Teléfono
            </label>
            <input
              value={acreedor.telefono}
              onChange={(e) => actualizarAcreedorRow(acreedor.id, { telefono: e.target.value })}
              placeholder="Ej: +57 300 000 0000"
              inputMode="tel"
              className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
              Tipo de identificación
            </label>
            <select
              value={acreedor.tipoIdentificacion}
              onChange={(e) =>
                actualizarAcreedorRow(acreedor.id, { tipoIdentificacion: e.target.value })
              }
              className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10 cursor-pointer"
            >
              <option value="">Seleccionar...</option>
              <option value="Cedula de Ciudadania">Cedula de Ciudadania</option>
              <option value="Cedula de Extranjeria">Cedula de Extranjeria</option>
              <option value="Pasaporte">Pasaporte</option>
              <option value="NIT">NIT</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
              Identificación
            </label>
            <input
              value={acreedor.identificacion}
              onChange={(e) =>
                actualizarAcreedorRow(acreedor.id, { identificacion: e.target.value })
              }
              placeholder="Ej: 9.876.543.210"
              className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
              Correo electrónico
            </label>
            <input
              value={acreedor.email}
              onChange={(e) => actualizarAcreedorRow(acreedor.id, { email: e.target.value })}
              placeholder="Ej: acreedor@empresa.com"
              inputMode="email"
              className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
              Apoderado
            </label>
            <div className="flex gap-2">
              <input
                value={acreedor.apoderadoNombre}
                onChange={(e) => handleRowApoderadoInput("acreedor", acreedor.id, e.target.value)}
                list="apoderados-list"
                placeholder="Busca un apoderado existente"
                className="flex-1 min-w-0 h-11 rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
              />
              <button
                type="button"
                onClick={() => abrirModalApoderado({ tipo: "acreedor", id: acreedor.id })}
                className="h-11 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
              >
                + Apoderado
              </button>
            </div>
            <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
              Opcional. Autocompleta con los apoderados disponibles o crea uno nuevo.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 p-3 dark:border-white/10 dark:bg-white/10">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-zinc-500 dark:text-zinc-400">
              Obligaciones
            </p>
            <button
              type="button"
              onClick={() => agregarObligacionRow(acreedor.id)}
              className="rounded-full border border-dashed border-zinc-300 px-2 py-0.5 text-[10px]"
            >
              + agregar
            </button>
          </div>
          <div className="mt-3 space-y-3">
            {acreedor.obligaciones.map((obligacion) => {
              const obligationTotal = computeObligacionTotal(obligacion);
              const formattedTotal = formatMontoInputValue(obligationTotal);
              const totalLabel = formatMontoLabel(obligationTotal);
              return (
                <div
                  key={obligacion.id}
                  className="space-y-3 rounded-2xl border border-zinc-200 bg-white/70 p-3 shadow-[0_0_0_1px_rgba(0,0,0,0.05)] dark:border-white/5 dark:bg-black/10"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">Obligación</p>
                    <button
                      type="button"
                      onClick={() => eliminarObligacionRow(acreedor.id, obligacion.id)}
                      className="text-xs font-semibold text-red-600 transition hover:text-red-700 dark:text-red-300 dark:hover:text-red-200"
                    >
                      Eliminar
                    </button>
                  </div>
                  <div className="space-y-2">
                    <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                      Descripción
                    </label>
                    <input
                      value={obligacion.descripcion}
                      onChange={(e) =>
                        actualizarObligacionRow(acreedor.id, obligacion.id, {
                          descripcion: e.target.value,
                        })
                      }
                      placeholder="Ej: Cuota febrero"
                      className="h-10 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-xs outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                        Naturaleza
                      </label>
                      <input
                        value={obligacion.naturaleza}
                        onChange={(e) =>
                          actualizarObligacionRow(acreedor.id, obligacion.id, {
                            naturaleza: e.target.value,
                          })
                        }
                        className="h-10 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-xs outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                        Prelación
                      </label>
                      <input
                        value={obligacion.prelacion}
                        onChange={(e) =>
                          actualizarObligacionRow(acreedor.id, obligacion.id, {
                            prelacion: e.target.value,
                          })
                        }
                        className="h-10 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-xs outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                        Capital
                      </label>
                      <input
                        type="number"
                        value={obligacion.capital}
                        onChange={(e) =>
                          actualizarObligacionRow(acreedor.id, obligacion.id, {
                            capital: e.target.value,
                          })
                        }
                        placeholder="Ej: 250000"
                        min="0"
                        step="0.01"
                        className="h-10 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-xs outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                        INT. CTE
                      </label>
                      <input
                        type="number"
                        value={obligacion.interesCte}
                        onChange={(e) =>
                          actualizarObligacionRow(acreedor.id, obligacion.id, {
                            interesCte: e.target.value,
                          })
                        }
                        placeholder="Ej: 5000"
                        min="0"
                        step="0.01"
                        className="h-10 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-xs outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                        INT MORA
                      </label>
                      <input
                        type="number"
                        value={obligacion.interesMora}
                        onChange={(e) =>
                          actualizarObligacionRow(acreedor.id, obligacion.id, {
                            interesMora: e.target.value,
                          })
                        }
                        placeholder="Ej: 2000"
                        min="0"
                        step="0.01"
                        className="h-10 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-xs outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                        Otros cobros/seguros
                      </label>
                      <input
                        type="number"
                        value={obligacion.otros}
                        onChange={(e) =>
                          actualizarObligacionRow(acreedor.id, obligacion.id, {
                            otros: e.target.value,
                          })
                        }
                        placeholder="Ej: 1000"
                        min="0"
                        step="0.01"
                        className="h-10 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-xs outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                        Total
                      </label>
                      <input
                        type="number"
                        value={formattedTotal}
                        readOnly
                        className="h-10 w-full rounded-2xl border border-zinc-200 bg-zinc-100 px-3 text-xs font-semibold outline-none text-zinc-900 transition dark:border-white/10 dark:bg-zinc-950/20 dark:text-white"
                      />
                      <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                        {totalLabel}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
            {acreedor.obligaciones.length === 0 && (
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Agrega todas las obligaciones necesarias para que la suma se refleje en el monto
                de acreencia.
              </p>
            )}
          </div>
          <p className="mt-3 text-[11px] text-zinc-500 dark:text-zinc-400">
            Total obligaciones:{" "}
            <span className="font-semibold text-zinc-900 dark:text-zinc-50">
              {totalObligacionesLabel}
            </span>
          </p>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
              Monto de acreencia
            </label>
            <input
              type="number"
              value={montoInputValue}
              onChange={(e) => {
                if (tieneMontoCalculado) return;
                actualizarAcreedorRow(acreedor.id, { monto: e.target.value });
              }}
              placeholder="Ej: 300000"
              min="0"
              step="0.01"
              readOnly={tieneMontoCalculado}
              className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
            />
            {tieneMontoCalculado && (
              <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                Suma calculada a partir de obligaciones: {totalObligacionesLabel}
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
              Tipo de acreencia
            </label>
            <input
              value={acreedor.tipoAcreencia}
              onChange={(e) =>
                actualizarAcreedorRow(acreedor.id, {
                  tipoAcreencia: e.target.value,
                })
              }
              placeholder="Ej: Ordinaria, Subordinada"
              className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <>

      <section className="rounded-3xl border border-zinc-200 bg-white/80 p-5 shadow-[0_12px_40px_-20px_rgba(0,0,0,0.35)] backdrop-blur dark:border-white/10 dark:bg-white/5 sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">
              {editingProcesoId ? "Editar Proceso" : "Crear Nuevo Proceso"}
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {cargandoDetalle
                ? "Cargando datos del proceso..."
                : editingProcesoId
                ? "Actualiza los datos y guarda los cambios."
                : "Gestiona los datos del proceso que estás creando."}
            </p>
          </div>
          {editingProcesoId && (
            <button
              type="button"
              onClick={resetFormFields}
              className="text-xs font-semibold text-indigo-600 transition hover:underline dark:text-indigo-300"
            >
              Crear nuevo
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-400">
            {error}
          </div>
        )}

        {exito && (
          <div className="mb-4 rounded-2xl border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950/50 dark:text-green-400">
            {exito}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {showGeneralInfo && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Número de Proceso *
                </label>
                <input
                  type="text"
                  value={numeroProceso}
                  onChange={(e) => setNumeroProceso(e.target.value)}
                  placeholder="Ej: 2024-001234"
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                  required
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Fecha de Inicio
                  </label>
                  <input
                    type="date"
                    value={fechaprocesos}
                    onChange={(e) => setFechaprocesos(e.target.value)}
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Estado
                  </label>
                  <select
                    value={estado}
                    onChange={(e) => setEstado(e.target.value)}
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10 cursor-pointer"
                  >
                    <option value="Activo">Activo</option>
                    <option value="En trámite">En trámite</option>
                    <option value="Suspendido">Suspendido</option>
                    <option value="Finalizado">Finalizado</option>
                    <option value="Archivado">Archivado</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Tipo de Proceso
                </label>
                <input
                  type="text"
                  value={tipoProceso}
                  onChange={(e) => setTipoProceso(e.target.value)}
                  placeholder="Ej: Liquidación, Reorganización"
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Juzgado
                </label>
                <input
                  type="text"
                  value={juzgado}
                  onChange={(e) => setJuzgado(e.target.value)}
                  placeholder="Ej: Juzgado 1 Civil del Circuito"
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Descripción
                </label>
                <textarea
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  placeholder="Descripción del proceso..."
                  rows={3}
                  className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10 resize-none"
                />
              </div>
            </>
          )}

          <div className="space-y-6">
            {shouldShowDeudoresSection && (
              <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
                <div className="flex items-center justify-between">
                  <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Deudores</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Agrega los deudores que participan en este proceso.
                  </p>
                  </div>
                </div>

              <div className="space-y-4 mt-4">
                {deudoresForm.map((deudor, index) => (
                  <div
                    key={deudor.id}
                    className="rounded-2xl border border-zinc-200 bg-white/70 p-4 shadow-sm transition hover:shadow-md dark:border-white/10 dark:bg-white/5"
                  >
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">
                        Deudor {index + 1}
                      </p>
                      <button
                        type="button"
                        onClick={() => eliminarDeudorRow(deudor.id)}
                        disabled={deudoresForm.length === 1}
                        className="rounded-full px-3 py-1 text-sm text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
                        title={
                          deudoresForm.length === 1
                            ? "Debe quedar al menos un deudor"
                            : "Eliminar"
                        }
                      >
                        Eliminar
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                          Nombre
                        </label>
                        <input
                          value={deudor.nombre}
                          onChange={(e) =>
                            actualizarDeudorRow(deudor.id, { nombre: e.target.value })
                          }
                          placeholder="Ej: Juan Pérez"
                          className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                          Teléfono
                        </label>
                        <input
                          value={deudor.telefono}
                          onChange={(e) =>
                            actualizarDeudorRow(deudor.id, { telefono: e.target.value })
                          }
                          placeholder="Ej: +57 300 000 0000"
                          inputMode="tel"
                          className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                          Tipo de identificación
                        </label>
                        <select
                          value={deudor.tipoIdentificacion}
                          onChange={(e) =>
                            actualizarDeudorRow(deudor.id, {
                              tipoIdentificacion: e.target.value,
                            })
                          }
                          className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10 cursor-pointer"
                        >
                          <option value="">Seleccionar...</option>
                          <option value="Cedula de Ciudadania">Cedula de Ciudadania</option>
                          <option value="Cedula de Extranjeria">Cedula de Extranjeria</option>
                          <option value="Pasaporte">Pasaporte</option>
                        </select>
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                          Identificación
                        </label>
                        <input
                          value={deudor.identificacion}
                          onChange={(e) =>
                            actualizarDeudorRow(deudor.id, { identificacion: e.target.value })
                          }
                          placeholder="Ej: 1.234.567.890"
                          className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                        />
                      </div>

                      <div>
                        <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                          Correo electrónico
                        </label>
                        <input
                          value={deudor.email}
                          onChange={(e) =>
                            actualizarDeudorRow(deudor.id, { email: e.target.value })
                          }
                          placeholder="Ej: ejemplo@correo.com"
                          inputMode="email"
                          className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                          Apoderado
                        </label>
                        <div className="flex gap-2">
                          <input
                            value={deudor.apoderadoNombre}
                            onChange={(e) =>
                              handleRowApoderadoInput("deudor", deudor.id, e.target.value)
                            }
                            list="apoderados-list"
                            placeholder="Busca un apoderado existente"
                            className="flex-1 min-w-0 h-11 rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                          />
                          <button
                            type="button"
                            onClick={() => abrirModalApoderado({ tipo: "deudor", id: deudor.id })}
                            className="h-11 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:text-zinc-200 dark:hover:bg-white/10"
                          >
                            + Apoderado
                          </button>
                        </div>
                        <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                          Opcional. Autocompleta con apoderados existentes o crea uno nuevo.
                        </p>
                      </div>

                      <div className="sm:col-span-2">
                        <label className="mb-1 block text-[11px] font-semibold text-zinc-600 dark:text-zinc-300">
                          Dirección
                        </label>
                        <input
                          value={deudor.direccion}
                          onChange={(e) =>
                            actualizarDeudorRow(deudor.id, { direccion: e.target.value })
                          }
                          placeholder="Ej: Calle 123 #45-67"
                          className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-3 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {deudoresForm.length > 0 && (
                <div className="mt-4 space-y-1">
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Deudor principal
                  </label>
                  <select
                    value={selectedDeudorId}
                    onChange={(e) => setSelectedDeudorId(e.target.value)}
                    className="h-11 w-full cursor-pointer rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                  >
                    {deudoresForm.map((deudor, index) => (
                      <option key={deudor.id} value={deudor.id}>
                        {deudor.nombre.trim() ? deudor.nombre : `Deudor ${index + 1}`}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Elige el deudor que figurará como principal en este proceso.
                  </p>
                </div>
              )}
            </div>
          )}
            {shouldShowAcreedoresSection && (
              <div className="rounded-2xl border border-zinc-200 bg-white/80 p-4 shadow-sm dark:border-white/10 dark:bg-white/5">
                <div className="flex items-center justify-between">
                  <div>
                  <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Acreedores</p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Añade los acreedores relacionados con el proceso.
                  </p>
                  </div>
                </div>

              <div className="space-y-4 mt-4">
                {acreedoresForm.map(renderAcreedorRow)}
              </div>

              {acreedoresForm.length > 0 && (
                <div className="mt-4 space-y-1">
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    Acreedor principal
                  </label>
                  <select
                    value={selectedAcreedorId}
                    onChange={(e) => setSelectedAcreedorId(e.target.value)}
                    className="h-11 w-full cursor-pointer rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                  >
                    {acreedoresForm.map((acreedor, index) => (
                      <option key={acreedor.id} value={acreedor.id}>
                        {acreedor.nombre.trim() ? acreedor.nombre : `Acreedor ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              </div>
            )}
          </div>

          <datalist id="apoderados-list">
            {apoderados.map((apoderado) => (
              <option
                key={apoderado.id}
                value={apoderado.nombre}
                label={
                  apoderado.identificacion
                    ? `${apoderado.nombre} (${apoderado.identificacion})`
                    : undefined
                }
              />
            ))}
          </datalist>

          <button
            type="submit"
            disabled={guardando || (showGeneralInfo && !numeroProceso.trim()) || disableSubmit}
            className="h-11 w-full rounded-2xl bg-zinc-950 px-6 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
          >
            {guardando
              ? "Guardando..."
              : submitLabel ?? (editingProcesoId ? "Guardar y continuar" : "Crear Proceso")}
          </button>
          {submitDisabledReason && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-300">{submitDisabledReason}</p>
          )}
        </form>
      </section>

      {apoderadoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={cerrarModalApoderado} />
          <div className="relative w-full max-w-md rounded-3xl border border-zinc-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-zinc-950 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">Nuevo apoderado</p>
                <h3 className="text-lg font-semibold dark:text-white">Asigna un apoderado</h3>
              </div>
              <button
                type="button"
                className="rounded-full px-3 py-1 text-sm text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
                onClick={cerrarModalApoderado}
              >
                Cerrar
              </button>
            </div>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                  Nombre *
                </label>
                <input
                  value={apoderadoForm.nombre}
                  onChange={(e) =>
                    setApoderadoForm((prev) => ({ ...prev, nombre: e.target.value }))
                  }
                  placeholder="Ej: Laura Gómez"
                  className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                    Identificación
                  </label>
                  <input
                    value={apoderadoForm.identificacion}
                    onChange={(e) =>
                      setApoderadoForm((prev) => ({ ...prev, identificacion: e.target.value }))
                    }
                    placeholder="Ej: 1.111.111.111"
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                    Correo electrónico
                  </label>
                  <input
                    value={apoderadoForm.email}
                    onChange={(e) =>
                      setApoderadoForm((prev) => ({ ...prev, email: e.target.value }))
                    }
                    inputMode="email"
                    placeholder="Ej: apoderado@firma.com"
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                    Teléfono
                  </label>
                  <input
                    value={apoderadoForm.telefono}
                    onChange={(e) =>
                      setApoderadoForm((prev) => ({ ...prev, telefono: e.target.value }))
                    }
                    inputMode="tel"
                    placeholder="Ej: +57 300 000 0000"
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-zinc-600 dark:text-zinc-300">
                    Dirección
                  </label>
                  <input
                    value={apoderadoForm.direccion}
                    onChange={(e) =>
                      setApoderadoForm((prev) => ({ ...prev, direccion: e.target.value }))
                    }
                    placeholder="Ej: Calle 8 #4-56"
                    className="h-11 w-full rounded-2xl border border-zinc-200 bg-white px-4 text-sm outline-none transition focus:border-zinc-950/30 focus:ring-4 focus:ring-zinc-950/10 dark:border-white/10 dark:bg-black/20 dark:focus:border-white/20 dark:focus:ring-white/10"
                  />
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={cerrarModalApoderado}
                className="h-11 rounded-2xl border border-zinc-200 bg-white px-5 text-sm font-medium shadow-sm transition hover:bg-zinc-100 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={guardarApoderado}
                disabled={apoderadoGuardando || !apoderadoForm.nombre.trim()}
                className="h-11 rounded-2xl bg-zinc-950 px-6 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-black"
              >
                {apoderadoGuardando ? "Guardando..." : "Agregar apoderado"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

