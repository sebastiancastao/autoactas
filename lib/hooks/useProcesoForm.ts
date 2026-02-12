"use client";

import { Dispatch, FormEvent, SetStateAction, useCallback, useEffect, useState } from "react";
import { createAcreedor, deleteAcreedor, updateAcreedor } from "@/lib/api/acreedores";
import {
  deleteAcreenciasByAcreedorIds,
  upsertAcreencias,
} from "@/lib/api/acreencias";
import { createDeudor, deleteDeudor, updateDeudor } from "@/lib/api/deudores";
import { createApoderado, getApoderados, updateApoderado } from "@/lib/api/apoderados";
import {
  createProceso,
  getProcesoWithRelations,
  updateProceso,
} from "@/lib/api/proceso";
import { updateProgresoByProcesoId } from "@/lib/api/progreso";
import {
  getDigitCount,
  isNitIdentification,
  NIT_REQUIRED_DIGITS,
} from "@/lib/utils/identificacion";
import type {
  Acreedor,
  Acreencia,
  Apoderado,
  Deudor,
  Proceso,
  ProcesoInsert,
} from "@/lib/database.types";

type DeudorFormRow = {
  id: string;
  dbId?: string;
  nombre: string;
  identificacion: string;
  tipoIdentificacion: string;
  direccion: string;
  telefono: string;
  email: string;
  apoderadoId: string;
  apoderadoNombre: string;
};

type ObligacionFormRow = {
  id: string;
  descripcion: string;
  naturaleza: string;
  prelacion: string;
  capital: string;
  interesCte: string;
  interesMora: string;
  otros: string;
};

type AcreedorFormRow = DeudorFormRow & {
  monto: string;
  tipoAcreencia: string;
  obligaciones: ObligacionFormRow[];
};

type ApoderadoModalTarget = {
  tipo: "deudor" | "acreedor";
  id: string;
};

type ApoderadoForm = {
  nombre: string;
  identificacion: string;
  email: string;
  telefono: string;
  direccion: string;
  tarjetaProfesional: string;
};

type AcreedorWithApoderado = Acreedor & {
  apoderados?: Apoderado[];
};

type AcreedorWithObligaciones = AcreedorWithApoderado & {
  acreencias?: Acreencia[];
  obligaciones?: {
    id?: string;
    descripcion?: string | null;
    monto?: number | null;
  }[];
};

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function createDeudorRow(): DeudorFormRow {
  return {
    id: uid(),
    nombre: "",
    identificacion: "",
    tipoIdentificacion: "",
    direccion: "",
    telefono: "",
    email: "",
    apoderadoId: "",
    apoderadoNombre: "",
  };
}

function createObligacionRow(): ObligacionFormRow {
  return {
    id: uid(),
    descripcion: "",
    naturaleza: "",
    prelacion: "",
    capital: "",
    interesCte: "",
    interesMora: "",
    otros: "",
  };
}

function createAcreedorRow(): AcreedorFormRow {
  return {
    id: uid(),
    nombre: "",
    identificacion: "",
    tipoIdentificacion: "",
    direccion: "",
    telefono: "",
    email: "",
    apoderadoId: "",
    apoderadoNombre: "",
    monto: "",
    tipoAcreencia: "",
    obligaciones: [],
  };
}

const obligationAmountFields: Array<keyof ObligacionFormRow> = [
  "capital",
  "interesCte",
  "interesMora",
  "otros",
];

function parseObligacionValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function computeObligacionTotal(obligacion: ObligacionFormRow) {
  return obligationAmountFields.reduce(
    (acc, key) => acc + parseObligacionValue(obligacion[key]),
    0,
  );
}

function hasObligacionAmounts(obligacion: ObligacionFormRow) {
  return obligationAmountFields.some((key) => obligacion[key].trim() !== "");
}

function createApoderadoForm(): ApoderadoForm {
  return {
    nombre: "",
    identificacion: "",
    email: "",
    telefono: "",
    direccion: "",
    tarjetaProfesional: "",
  };
}

function mapDeudoresToFormRows(deudores?: Deudor[], apoderados?: Apoderado[]): DeudorFormRow[] {
  if (!deudores || deudores.length === 0) {
    return [createDeudorRow()];
  }

  const apoderadoLookup = new Map(apoderados?.map((a) => [a.id, a.nombre]) ?? []);

  return deudores.map((deudor) => ({
    id: uid(),
    dbId: deudor.id,
    nombre: deudor.nombre,
    identificacion: deudor.identificacion,
    tipoIdentificacion: deudor.tipo_identificacion ?? "",
    direccion: deudor.direccion ?? "",
    telefono: deudor.telefono ?? "",
    email: deudor.email ?? "",
    apoderadoId: deudor.apoderado_id ?? "",
    apoderadoNombre: deudor.apoderado_id
      ? apoderadoLookup.get(deudor.apoderado_id) ?? ""
      : "",
  }));
}

function mapAcreedoresToFormRows(
  acreedores?: AcreedorWithObligaciones[],
  apoderados?: Apoderado[]
): AcreedorFormRow[] {
  if (!acreedores || acreedores.length === 0) {
    return [createAcreedorRow()];
  }

  const apoderadoLookup = new Map(apoderados?.map((a) => [a.id, a.nombre]) ?? []);

  return acreedores.map((acreedor) => ({
    ...(() => {
      const acreenciaFromRelation =
        (acreedor.acreencias ?? []).find(
          (item) => !acreedor.apoderado_id || item.apoderado_id === acreedor.apoderado_id,
        ) ?? (acreedor.acreencias ?? [])[0];

      const obligacionesFromAcreencias = acreenciaFromRelation
        ? [
            {
              id: uid(),
              descripcion: "",
              naturaleza: acreenciaFromRelation.naturaleza ?? "",
              prelacion: acreenciaFromRelation.prelacion ?? "",
              capital:
                acreenciaFromRelation.capital != null ? acreenciaFromRelation.capital.toString() : "",
              interesCte:
                acreenciaFromRelation.int_cte != null ? acreenciaFromRelation.int_cte.toString() : "",
              interesMora:
                acreenciaFromRelation.int_mora != null ? acreenciaFromRelation.int_mora.toString() : "",
              otros:
                acreenciaFromRelation.otros_cobros_seguros != null
                  ? acreenciaFromRelation.otros_cobros_seguros.toString()
                  : "",
            },
          ]
        : [];

      const obligacionesLegacy =
        acreedor.obligaciones?.map((obligacion) => ({
          id: uid(),
          descripcion: obligacion.descripcion ?? "",
          naturaleza: "",
          prelacion: "",
          capital: obligacion.monto != null ? obligacion.monto.toString() : "",
          interesCte: "",
          interesMora: "",
          otros: "",
        })) ?? [];

      return {
        obligaciones:
          obligacionesFromAcreencias.length > 0
            ? obligacionesFromAcreencias
            : obligacionesLegacy,
      };
    })(),
    id: uid(),
    dbId: acreedor.id,
    nombre: acreedor.nombre,
    identificacion: acreedor.identificacion,
    tipoIdentificacion: acreedor.tipo_identificacion ?? "",
    direccion: acreedor.direccion ?? "",
    telefono: acreedor.telefono ?? "",
    email: acreedor.email ?? "",
    apoderadoId: acreedor.apoderado_id ?? "",
    apoderadoNombre: acreedor.apoderado_id
      ? apoderadoLookup.get(acreedor.apoderado_id) ?? ""
      : "",
    monto: acreedor.monto_acreencia != null ? acreedor.monto_acreencia.toString() : "",
    tipoAcreencia: acreedor.tipo_acreencia ?? "",
  }));
}

export type UseProcesoFormOptions = {
  initialProcesoId?: string;
  onSaveSuccess?: (proceso: Proceso, context?: { isEditing: boolean }) => void;
  focusedMode?: "acreedores" | "deudores" | undefined;
  updateProgresoOnSubmit?: boolean;
};

export type ProcesoFormContext = {
  numeroProceso: string;
  setNumeroProceso: Dispatch<SetStateAction<string>>;
  fechaprocesos: string;
  setFechaprocesos: Dispatch<SetStateAction<string>>;
  estado: string;
  setEstado: Dispatch<SetStateAction<string>>;
  descripcion: string;
  setDescripcion: Dispatch<SetStateAction<string>>;
  tipoProceso: string;
  setTipoProceso: Dispatch<SetStateAction<string>>;
  juzgado: string;
  setJuzgado: Dispatch<SetStateAction<string>>;
  deudoresForm: DeudorFormRow[];
  agregarDeudorRow: () => void;
  actualizarDeudorRow: (id: string, patch: Partial<DeudorFormRow>) => void;
  eliminarDeudorRow: (id: string) => void;
  selectedDeudorId: string;
  setSelectedDeudorId: Dispatch<SetStateAction<string>>;
  acreedoresForm: AcreedorFormRow[];
  agregarAcreedorRow: () => void;
  actualizarAcreedorRow: (id: string, patch: Partial<AcreedorFormRow>) => void;
  eliminarAcreedorRow: (id: string) => void;
  agregarObligacionRow: (acreedorId: string) => void;
  actualizarObligacionRow: (
    acreedorId: string,
    obligacionId: string,
    patch: Partial<ObligacionFormRow>,
  ) => void;
  eliminarObligacionRow: (acrecedorId: string, obligacionId: string) => void;
  selectedAcreedorId: string;
  setSelectedAcreedorId: Dispatch<SetStateAction<string>>;
  apoderados: Apoderado[];
  apoderadoModalOpen: boolean;
  apoderadoModalTarget: ApoderadoModalTarget | null;
  apoderadoForm: ApoderadoForm;
  setApoderadoForm: Dispatch<SetStateAction<ApoderadoForm>>;
  apoderadoGuardando: boolean;
  guardarApoderado: () => Promise<void>;
  abrirModalApoderado: (target: ApoderadoModalTarget) => void;
  cerrarModalApoderado: () => void;
  handleRowApoderadoInput: (
    tipo: ApoderadoModalTarget["tipo"],
    rowId: string,
    value: string
  ) => void;
  cargandoDetalle: boolean;
  guardando: boolean;
  error: string | null;
  exito: string | null;
  editingProcesoId: string | null;
  cargandoApoderados: boolean;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  resetFormFields: () => void;
  cargarProcesoDetalle: (procesoId: string) => Promise<void>;
};

export function useProcesoForm(options?: UseProcesoFormOptions): ProcesoFormContext {
  const {
    initialProcesoId,
    onSaveSuccess,
    focusedMode,
    updateProgresoOnSubmit = true,
  } = options ?? {};

  const [numeroProceso, setNumeroProceso] = useState("");
  const [fechaprocesos, setFechaprocesos] = useState(() => new Date().toISOString().split("T")[0]);
  const [estado, setEstado] = useState("Activo");
  const [descripcion, setDescripcion] = useState("");
  const [tipoProceso, setTipoProceso] = useState("");
  const [juzgado, setJuzgado] = useState("");
  const [apoderados, setApoderados] = useState<Apoderado[]>([]);
  const [cargandoApoderados, setCargandoApoderados] = useState(false);
  const [apoderadoModalOpen, setApoderadoModalOpen] = useState(false);
  const [apoderadoModalTarget, setApoderadoModalTarget] = useState<ApoderadoModalTarget | null>(null);
  const [apoderadoForm, setApoderadoForm] = useState<ApoderadoForm>(() => createApoderadoForm());
  const [apoderadoGuardando, setApoderadoGuardando] = useState(false);
  const [editingProcesoId, setEditingProcesoId] = useState<string | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [originalDeudoresIds, setOriginalDeudoresIds] = useState<string[]>([]);
  const [originalAcreedoresIds, setOriginalAcreedoresIds] = useState<string[]>([]);
  const [deudoresForm, setDeudoresForm] = useState<DeudorFormRow[]>(() => [createDeudorRow()]);
  const [selectedDeudorId, setSelectedDeudorId] = useState<string>(() => deudoresForm[0]?.id ?? "");
  const [acreedoresForm, setAcreedoresForm] = useState<AcreedorFormRow[]>(() => [createAcreedorRow()]);
  const [selectedAcreedorId, setSelectedAcreedorId] = useState<string>(() => acreedoresForm[0]?.id ?? "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  useEffect(() => {
    if (deudoresForm.length === 0) {
      setSelectedDeudorId("");
      return;
    }
    if (!deudoresForm.some((fila) => fila.id === selectedDeudorId)) {
      setSelectedDeudorId(deudoresForm[0].id);
    }
  }, [deudoresForm, selectedDeudorId]);

  useEffect(() => {
    if (acreedoresForm.length === 0) {
      setSelectedAcreedorId("");
      return;
    }
    if (!acreedoresForm.some((fila) => fila.id === selectedAcreedorId)) {
      setSelectedAcreedorId(acreedoresForm[0].id);
    }
  }, [acreedoresForm, selectedAcreedorId]);

  const agregarDeudorRow = () => {
    const nuevaFila = createDeudorRow();
    setDeudoresForm((prev) => [...prev, nuevaFila]);
    setSelectedDeudorId(nuevaFila.id);
  };

  const actualizarDeudorRow = (id: string, patch: Partial<DeudorFormRow>) => {
    setDeudoresForm((prev) => prev.map((fila) => (fila.id === id ? { ...fila, ...patch } : fila)));
  };

  const eliminarDeudorRow = (id: string) => {
    setDeudoresForm((prev) => prev.filter((fila) => fila.id !== id));
  };

  const agregarAcreedorRow = () => {
    const nuevaFila = createAcreedorRow();
    setAcreedoresForm((prev) => [...prev, nuevaFila]);
    setSelectedAcreedorId(nuevaFila.id);
  };

  const actualizarAcreedorRow = (id: string, patch: Partial<AcreedorFormRow>) => {
    setAcreedoresForm((prev) => prev.map((fila) => (fila.id === id ? { ...fila, ...patch } : fila)));
  };

  const eliminarAcreedorRow = (id: string) => {
    setAcreedoresForm((prev) => prev.filter((fila) => fila.id !== id));
  };

  const agregarObligacionRow = (acreedorId: string) => {
    setAcreedoresForm((prev) =>
      prev.map((fila) =>
        fila.id === acreedorId
          ? { ...fila, obligaciones: [...fila.obligaciones, createObligacionRow()] }
          : fila,
      ),
    );
  };

  const actualizarObligacionRow = (
    acreedorId: string,
    obligacionId: string,
    patch: Partial<ObligacionFormRow>,
  ) => {
    setAcreedoresForm((prev) =>
      prev.map((fila) =>
        fila.id === acreedorId
          ? {
              ...fila,
              obligaciones: fila.obligaciones.map((obligacion) =>
                obligacion.id === obligacionId ? { ...obligacion, ...patch } : obligacion,
              ),
            }
          : fila,
      ),
    );
  };

  const eliminarObligacionRow = (acreedorId: string, obligacionId: string) => {
    setAcreedoresForm((prev) =>
      prev.map((fila) =>
        fila.id === acreedorId
          ? {
              ...fila,
              obligaciones: fila.obligaciones.filter((obligacion) => obligacion.id !== obligacionId),
            }
          : fila,
      ),
    );
  };

  const handleRowApoderadoInput = (
    tipo: ApoderadoModalTarget["tipo"],
    rowId: string,
    value: string
  ) => {
    const match = apoderados.find((a) => a.nombre === value);
    const patch = {
      apoderadoNombre: value,
      apoderadoId: match ? match.id : "",
    };
    if (tipo === "deudor") {
      actualizarDeudorRow(rowId, patch);
    } else {
      actualizarAcreedorRow(rowId, patch);
    }
  };

  const abrirModalApoderado = (target: ApoderadoModalTarget) => {
    setApoderadoModalTarget(target);
    setApoderadoForm(createApoderadoForm());
    setApoderadoModalOpen(true);
  };

  const cerrarModalApoderado = () => {
    setApoderadoModalOpen(false);
    setApoderadoModalTarget(null);
  };

  const resetFormFields = () => {
    const nuevaFilaDeudor = createDeudorRow();
    const nuevaFilaAcreedor = createAcreedorRow();
    setNumeroProceso("");
    setFechaprocesos(new Date().toISOString().split("T")[0]);
    setEstado("Activo");
    setDescripcion("");
    setTipoProceso("");
    setJuzgado("");
    setDeudoresForm([nuevaFilaDeudor]);
    setSelectedDeudorId(nuevaFilaDeudor.id);
    setAcreedoresForm([nuevaFilaAcreedor]);
    setSelectedAcreedorId(nuevaFilaAcreedor.id);
    setEditingProcesoId(null);
    setOriginalDeudoresIds([]);
    setOriginalAcreedoresIds([]);
    setError(null);
    setExito(null);
  };

  const cargarProcesoDetalle = useCallback(
    async (procesoId: string) => {
      setCargandoDetalle(true);
      setError(null);
      setExito(null);
      try {
        const detalle = await getProcesoWithRelations(procesoId);
        if (!detalle) {
          setError("No se encontró el proceso");
          return;
        }
        const procesoApoderados = detalle.apoderados ?? [];
        setEditingProcesoId(detalle.id);
        setNumeroProceso(detalle.numero_proceso);
        setFechaprocesos(detalle.fecha_procesos ?? new Date().toISOString().split("T")[0]);
        setEstado(detalle.estado ?? "Activo");
        setDescripcion(detalle.descripcion ?? "");
        setTipoProceso(detalle.tipo_proceso ?? "");
        setJuzgado(detalle.juzgado ?? "");

        const deudorRows = mapDeudoresToFormRows(detalle.deudores, procesoApoderados);
        setOriginalDeudoresIds(detalle.deudores?.map((deudor) => deudor.id) ?? []);
        setDeudoresForm(deudorRows);
        setSelectedDeudorId(deudorRows[0]?.id ?? "");

        const acreedorRows = mapAcreedoresToFormRows(detalle.acreedores, procesoApoderados);
        setOriginalAcreedoresIds(detalle.acreedores?.map((acreedor) => acreedor.id) ?? []);
        setAcreedoresForm(acreedorRows);
        setSelectedAcreedorId(acreedorRows[0]?.id ?? "");
      } catch (err) {
        console.error("Error loading proceso:", err);
        setError("Error al cargar el proceso seleccionado");
      } finally {
        setCargandoDetalle(false);
      }
    },
    []
  );

  const fetchApoderadosList = async () => {
    setCargandoApoderados(true);
    try {
      const data = await getApoderados();
      setApoderados(data || []);
    } catch (err) {
      console.error("Error fetching apoderados:", err);
    } finally {
      setCargandoApoderados(false);
    }
  };

  const syncDeudores = async (procesoId: string, isEditing: boolean) => {
    const filasConNombre = deudoresForm.filter((fila) => fila.nombre.trim());
    const paraCrear = filasConNombre.filter((fila) => !fila.dbId);
    const paraActualizar = filasConNombre.filter((fila) => fila.dbId);
    const idsActivos = new Set(paraActualizar.map((fila) => fila.dbId));
    const idsParaEliminar = isEditing
      ? originalDeudoresIds.filter((id) => !idsActivos.has(id))
      : [];

    const construirPayload = (fila: DeudorFormRow) => ({
      proceso_id: procesoId,
      apoderado_id: fila.apoderadoId.trim() || null,
      nombre: fila.nombre.trim(),
      identificacion: fila.identificacion.trim(),
      tipo_identificacion: fila.tipoIdentificacion.trim() || null,
      direccion: fila.direccion.trim() || null,
      telefono: fila.telefono.trim() || null,
      email: fila.email.trim() || null,
    });

    await Promise.all(paraCrear.map((fila) => createDeudor(construirPayload(fila))));
    await Promise.all(
      paraActualizar.map((fila) => updateDeudor(fila.dbId!, construirPayload(fila)))
    );
    if (idsParaEliminar.length > 0) {
      await Promise.all(idsParaEliminar.map((id) => deleteDeudor(id)));
    }
  };

  const syncAcreedores = async (procesoId: string, isEditing: boolean) => {
    const filasConNombre = acreedoresForm.filter((fila) => fila.nombre.trim());
    const paraCrear = filasConNombre.filter((fila) => !fila.dbId);
    const paraActualizar = filasConNombre.filter((fila) => fila.dbId);
    const idsActivos = new Set(paraActualizar.map((fila) => fila.dbId));
    const idsParaEliminar = isEditing
      ? originalAcreedoresIds.filter((id) => !idsActivos.has(id))
      : [];

    const construirPayload = (fila: AcreedorFormRow) => {
      const totalObligaciones = fila.obligaciones.reduce(
        (acc, obligacion) => acc + computeObligacionTotal(obligacion),
        0,
      );
      const hasMontoObligaciones = fila.obligaciones.some((obligacion) =>
        hasObligacionAmounts(obligacion),
      );
      const montoDesdeObligaciones = hasMontoObligaciones ? totalObligaciones : null;
      const montoManualParsed = fila.monto.trim() ? Number(fila.monto) : null;
      const montoManualValid =
        montoManualParsed != null && !Number.isNaN(montoManualParsed) ? montoManualParsed : null;
      const montoFinal = montoDesdeObligaciones ?? montoManualValid;
      return {
        proceso_id: procesoId,
        nombre: fila.nombre.trim(),
        identificacion: fila.identificacion.trim(),
        tipo_identificacion: fila.tipoIdentificacion.trim() || null,
        direccion: fila.direccion.trim() || null,
        telefono: fila.telefono.trim() || null,
        email: fila.email.trim() || null,
        apoderado_id: fila.apoderadoId || null,
        monto_acreencia: montoFinal,
        tipo_acreencia: fila.tipoAcreencia.trim() || null,
      };
    };

    const creados = await Promise.all(
      paraCrear.map(async (fila) => {
        const saved = await createAcreedor(construirPayload(fila));
        return { formId: fila.id, dbId: saved.id };
      }),
    );
    const actualizados = await Promise.all(
      paraActualizar.map(async (fila) => {
        const saved = await updateAcreedor(fila.dbId!, construirPayload(fila));
        return { formId: fila.id, dbId: saved.id };
      }),
    );

    const acreedorDbIdByFormId = new Map<string, string>();
    creados.forEach((item) => acreedorDbIdByFormId.set(item.formId, item.dbId));
    actualizados.forEach((item) => acreedorDbIdByFormId.set(item.formId, item.dbId));

    if (idsParaEliminar.length > 0) {
      await deleteAcreenciasByAcreedorIds(idsParaEliminar);
      await Promise.all(idsParaEliminar.map((id) => deleteAcreedor(id)));
    }

    const acreenciasPayload = filasConNombre.flatMap((fila) => {
      const acreedorId = acreedorDbIdByFormId.get(fila.id) ?? fila.dbId;
      const apoderadoId = fila.apoderadoId.trim();
      if (!acreedorId || !apoderadoId) return [];

      const naturaleza =
        fila.obligaciones.find((obligacion) => obligacion.naturaleza.trim())?.naturaleza.trim() ||
        null;
      const prelacion =
        fila.obligaciones.find((obligacion) => obligacion.prelacion.trim())?.prelacion.trim() ||
        null;

      const hasCapital = fila.obligaciones.some((obligacion) => obligacion.capital.trim() !== "");
      const hasIntCte = fila.obligaciones.some((obligacion) => obligacion.interesCte.trim() !== "");
      const hasIntMora = fila.obligaciones.some((obligacion) => obligacion.interesMora.trim() !== "");
      const hasOtros = fila.obligaciones.some((obligacion) => obligacion.otros.trim() !== "");
      const montoManual = parseOptionalNumber(fila.monto);
      const hasAnyMeta = Boolean(naturaleza || prelacion);
      const hasAnyComponente = hasCapital || hasIntCte || hasIntMora || hasOtros;

      // Avoid creating empty acreencias rows when no acreencia data was provided.
      if (!hasAnyMeta && !hasAnyComponente && montoManual == null) {
        return [];
      }

      // Some legacy DBs define these columns as NOT NULL; send 0 when omitted.
      const capital = hasCapital
        ? fila.obligaciones.reduce((acc, obligacion) => acc + parseObligacionValue(obligacion.capital), 0)
        : 0;
      const intCte = hasIntCte
        ? fila.obligaciones.reduce((acc, obligacion) => acc + parseObligacionValue(obligacion.interesCte), 0)
        : 0;
      const intMora = hasIntMora
        ? fila.obligaciones.reduce((acc, obligacion) => acc + parseObligacionValue(obligacion.interesMora), 0)
        : 0;
      const otros = hasOtros
        ? fila.obligaciones.reduce((acc, obligacion) => acc + parseObligacionValue(obligacion.otros), 0)
        : 0;
      const totalFromComponentes = capital + intCte + intMora + otros;
      const total = hasAnyComponente ? totalFromComponentes : (montoManual ?? 0);

      return [
        {
          proceso_id: procesoId,
          apoderado_id: apoderadoId,
          acreedor_id: acreedorId,
          naturaleza,
          prelacion,
          capital,
          int_cte: intCte,
          int_mora: intMora,
          otros_cobros_seguros: otros,
          total,
          porcentaje: 0,
        },
      ];
    });

    if (acreenciasPayload.length > 0) {
      await upsertAcreencias(acreenciasPayload);
    }
  };

  const guardarApoderado = async () => {
    if (!apoderadoForm.nombre.trim() || apoderadoGuardando) return;
    if (!apoderadoModalTarget) return;

    try {
      setApoderadoGuardando(true);
      const created = await createApoderado({
        proceso_id: editingProcesoId ?? null,
        nombre: apoderadoForm.nombre.trim(),
        identificacion: apoderadoForm.identificacion.trim(),
        email: apoderadoForm.email.trim() || null,
        telefono: apoderadoForm.telefono.trim() || null,
        direccion: apoderadoForm.direccion.trim() || null,
        tarjeta_profesional: apoderadoForm.tarjetaProfesional.trim() || null,
      });
      setApoderados((prev) => [created, ...prev]);
      if (apoderadoModalTarget.tipo === "deudor") {
        actualizarDeudorRow(apoderadoModalTarget.id, {
          apoderadoId: created.id,
          apoderadoNombre: created.nombre,
        });
      } else {
        actualizarAcreedorRow(apoderadoModalTarget.id, {
          apoderadoId: created.id,
          apoderadoNombre: created.nombre,
        });
      }
    } catch (err) {
      const errorDetails =
        err instanceof Error
          ? err.message
          : err && typeof err === "object"
          ? JSON.stringify(err, Object.getOwnPropertyNames(err))
          : String(err);
      console.error("Error creando apoderado:", errorDetails, err);
    } finally {
      setApoderadoGuardando(false);
      cerrarModalApoderado();
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setExito(null);

    if (!numeroProceso.trim() && !editingProcesoId) {
      setError("El número de proceso es requerido");
      return;
    }

    const invalidNitAcreedor = acreedoresForm.find((fila) => {
      if (!isNitIdentification(fila.tipoIdentificacion)) {
        return false;
      }
      return getDigitCount(fila.identificacion) !== NIT_REQUIRED_DIGITS;
    });

    if (invalidNitAcreedor) {
      const displayName = invalidNitAcreedor.nombre.trim() || "sin nombre";
      setError(
        `El NIT del acreedor ${displayName} debe contener exactamente ${NIT_REQUIRED_DIGITS} dígitos numéricos.`,
      );
      return;
    }

    try {
      setGuardando(true);
      const procesoPayload: ProcesoInsert = {
        numero_proceso: numeroProceso.trim(),
        fecha_procesos: fechaprocesos,
        estado: estado || null,
        descripcion: descripcion.trim() || null,
        tipo_proceso: tipoProceso.trim() || null,
        juzgado: juzgado.trim() || null,
      };

      const isEditing = Boolean(editingProcesoId);
      const savedProceso = isEditing
        ? await updateProceso(editingProcesoId!, procesoPayload)
        : await createProceso(procesoPayload);

      if (focusedMode === "acreedores") {
        await syncAcreedores(savedProceso.id, isEditing);
      } else if (focusedMode === "deudores") {
        await syncDeudores(savedProceso.id, isEditing);
      } else {
        await syncDeudores(savedProceso.id, isEditing);
        await syncAcreedores(savedProceso.id, isEditing);
      }

      // Update proceso_id on apoderados that were assigned but have no proceso_id yet
      if (!isEditing) {
        const usedApoderadoIds = new Set<string>();
        for (const row of deudoresForm) {
          if (row.apoderadoId.trim()) usedApoderadoIds.add(row.apoderadoId.trim());
        }
        for (const row of acreedoresForm) {
          if (row.apoderadoId.trim()) usedApoderadoIds.add(row.apoderadoId.trim());
        }
        const apoderadosSinProceso = apoderados.filter(
          (ap) => usedApoderadoIds.has(ap.id) && !ap.proceso_id
        );
        await Promise.all(
          apoderadosSinProceso.map((ap) =>
            updateApoderado(ap.id, { proceso_id: savedProceso.id })
          )
        );
      }

      if (updateProgresoOnSubmit) {
        if (isEditing) {
          try {
            await updateProgresoByProcesoId(savedProceso.id, { estado: "iniciado" });
          } catch (err) {
            console.error("Error updating progreso:", err);
          }
        } else {
          try {
            await updateProgresoByProcesoId(savedProceso.id, { estado: "no_iniciado" });
          } catch (err) {
            console.error("Error initializing progreso for new proceso:", err);
          }
        }
      }

      onSaveSuccess?.(savedProceso, { isEditing });

      if (isEditing) {
        await cargarProcesoDetalle(savedProceso.id);
        setExito("Proceso actualizado exitosamente");
      } else {
        resetFormFields();
        setExito("Proceso creado exitosamente");
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : (err as { message?: string })?.message || String(err);
      console.error("Error saving proceso:", errorMessage, err);
      setError(editingProcesoId ? `Error al actualizar el proceso: ${errorMessage}` : `Error al crear el proceso: ${errorMessage}`);
    } finally {
      setGuardando(false);
    }
  };

  useEffect(() => {
    fetchApoderadosList();
  }, []);

  useEffect(() => {
    if (initialProcesoId) {
      cargarProcesoDetalle(initialProcesoId);
    }
  }, [initialProcesoId, cargarProcesoDetalle]);

  return {
    numeroProceso,
    setNumeroProceso,
    fechaprocesos,
    setFechaprocesos,
    estado,
    setEstado,
    descripcion,
    setDescripcion,
    tipoProceso,
    setTipoProceso,
    juzgado,
    setJuzgado,
    deudoresForm,
    agregarDeudorRow,
    actualizarDeudorRow,
    eliminarDeudorRow,
    selectedDeudorId,
    setSelectedDeudorId,
    acreedoresForm,
    agregarAcreedorRow,
    actualizarAcreedorRow,
    eliminarAcreedorRow,
    agregarObligacionRow,
    actualizarObligacionRow,
    eliminarObligacionRow,
    selectedAcreedorId,
    setSelectedAcreedorId,
    apoderados,
    apoderadoModalOpen,
    apoderadoModalTarget,
    apoderadoForm,
    setApoderadoForm,
    apoderadoGuardando,
    guardarApoderado,
    abrirModalApoderado,
    cerrarModalApoderado,
    handleRowApoderadoInput,
    cargandoDetalle,
    guardando,
    error,
    exito,
    editingProcesoId,
    cargandoApoderados,
    handleSubmit,
    resetFormFields,
    cargarProcesoDetalle,
  };
}
