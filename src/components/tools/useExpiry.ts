import { useEffect, useState } from 'react';

/** true cuando pasa `expiresAt` (ISO). Un solo timer hasta ese momento. */
export function useExpired(expiresAt: string | null | undefined) {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    setExpired(false);
    if (!expiresAt) return;
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (!Number.isFinite(ms)) return;
    if (ms <= 0) { setExpired(true); return; }
    const timer = window.setTimeout(() => setExpired(true), Math.min(ms, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [expiresAt]);
  return expired;
}

/** Arma un File-reader seguro para CSV (quita el BOM). */
export async function readCsv(file: File) {
  const text = await file.text();
  return text.replace(/^﻿/, '');
}

export const errorText = (reason: unknown, fallback = 'Error de conexión. Reintentá en un momento.') => (reason instanceof Error && reason.message ? reason.message : fallback);

/** Un CSV con columnas de menos no se arregla reintentando: solo se ofrece Reintentar ante errores de red o del server. */
export const canRetryCsv = (item: { error?: string }) => !/^(Faltan columnas|El CSV)/.test(item.error || '');
