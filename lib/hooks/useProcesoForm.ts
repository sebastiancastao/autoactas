"use client";

import { Dispatch, FormEvent, SetStateAction, useCallback, useEffect, useState } from "react";
import { createAcreedor, deleteAcreedor, updateAcreedor } from "@/lib/api/acreedores";
import { createDeudor, deleteDeudor, updateDeudor } from "@/lib/api/deudores";
import { createApoderado, getApoderados } from "@/lib/api/apoderados";
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
  obligaciones?: {
    id?: string;
    descripcion?: string | null;
    monto?: number | null;
  }[];
};

type ProcesoWithRelations = Proceso & {
  deudores?: Deudor[];
  acreedores?: AcreedorWithApoderado[];
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
    obligaciones:
      acreedor.obligaciones?.map((obligacion) => ({
        id: uid(),
        descripcion: obligacion.descripcion ?? "",
        naturaleza: "",
        prelacion: "",
        capital: obligacion.monto != null ? obligacion.monto.toString() : "",
        interesCte: "",
        interesMora: "",
        otros: "",
      })) ?? [],
  }));
}

export type UseProcesoFormOptions = {
  initialProcesoId?: string;
  onSaveSuccess?: (proceso: Proceso, context?: { isEditing: boolean }) => void;
  focusedMode?: "acreedores" | "deudores" | undefined;
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
  const { initialProcesoId, onSaveSuccess, focusedMode } = options ?? {};

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

    await Promise.all(paraCrear.map((fila) => createAcreedor(construirPayload(fila))));
    await Promise.all(
      paraActualizar.map((fila) => updateAcreedor(fila.dbId!, construirPayload(fila)))
    );
    if (idsParaEliminar.length > 0) {
      await Promise.all(idsParaEliminar.map((id) => deleteAcreedor(id)));
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

      onSaveSuccess?.(savedProceso, { isEditing });

      if (isEditing) {
        setExito("Proceso actualizado exitosamente");
        await cargarProcesoDetalle(savedProceso.id);
      } else {
        setExito("Proceso creado exitosamente");
        resetFormFields();
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
