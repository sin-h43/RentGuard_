'use client';
import { useCallback, useEffect, useState } from 'react';

export async function api<T = any>(path: string, init?: RequestInit): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && init?.body instanceof FormData;
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: init?.body && !isForm ? { 'Content-Type': 'application/json', ...(init.headers ?? {}) } : init?.headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error ?? `Request failed (${res.status})`);
  return data as T;
}
export const post = <T = any,>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
export const patch = <T = any,>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) });

export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!path) return;
    try {
      setLoading(true);
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, loading, reload: load };
}

/** Runs an async action and keeps a success / error message for the UI. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>, ok?: string | ((r: T) => string), after?: () => void) => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await fn();
      setMsg(typeof ok === 'function' ? ok(r) : (ok ?? 'Done.'));
      after?.();
      return r;
    } catch (e) {
      setErr((e as Error).message);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { run, busy, msg, err, clear: () => (setMsg(null), setErr(null)) };
}

/** 'BAIT_AND_SWITCH' -> 'BAIT AND SWITCH', 'filedBy' -> 'filed By' */
export const humanize = (s: string) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');

export const inr = (n: number | string | null | undefined) =>
  n === null || n === undefined || n === '' ? '-' : '₹' + Number(n).toLocaleString('en-IN');

export const fmtDate = (s?: string | null) => {
  if (!s) return '-';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
export const fmtDateTime = (s?: string | null) => {
  if (!s) return '-';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};
