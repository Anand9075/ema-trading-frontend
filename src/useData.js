import { useState, useEffect, useCallback, useRef } from "react";

/**
 * usePolling — fetches data on mount and every `interval` ms
 */
export function usePolling(fetchFn, interval = 30000, deps = []) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const mountedRef = useRef(true);

  const fetch = useCallback(async () => {
    try {
      const result = await fetchFn();
      if (mountedRef.current) { setData(result); setError(null); }
    } catch (err) {
      if (mountedRef.current) setError(err.message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, deps); // eslint-disable-line

  useEffect(() => {
    mountedRef.current = true;
    fetch();
    const id = setInterval(fetch, interval);
    return () => { mountedRef.current = false; clearInterval(id); };
  }, [fetch, interval]);

  return { data, loading, error, refetch: fetch };
}

/**
 * useTrades — manages trade state with CRUD operations
 */
export function useTrades() {
  const [trades,  setTrades]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const loadTrades = useCallback(async () => {
    try {
      const { tradeAPI } = await import("../api");
      const data = await tradeAPI.getAll();
      setTrades(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadTrades(); }, [loadTrades]);

  return { trades, loading, error, reload: loadTrades, setTrades };
}

/**
 * useAlerts — polls for new alerts every 15 seconds
 */
export function useAlerts() {
  const [alerts,  setAlerts]  = useState([]);
  const [unread,  setUnread]  = useState(0);
  const lastCheck = useRef(Date.now() - 3_600_000); // 1h back on first load

  const checkNew = useCallback(async () => {
    try {
      const { alertAPI } = await import("../api");
      const newAlerts = await alertAPI.getAll(lastCheck.current);
      if (Array.isArray(newAlerts) && newAlerts.length > 0) {
        setAlerts(prev => {
          const ids = new Set(prev.map(a => a._id));
          return [...newAlerts.filter(a => !ids.has(a._id)), ...prev];
        });
        setUnread(n => n + newAlerts.length);
      }
      lastCheck.current = Date.now();
    } catch(e) {}
  }, []);

  // Initial full load
  useEffect(() => {
    (async () => {
      try {
        const { alertAPI } = await import("../api");
        const data = await alertAPI.getAll();
        if (Array.isArray(data)) {
          setAlerts(data);
          setUnread(data.filter(a => !a.read).length);
        }
        lastCheck.current = Date.now();
      } catch(e) {}
    })();
  }, []);

  // Poll every 15s
  useEffect(() => {
    const id = setInterval(checkNew, 15000);
    return () => clearInterval(id);
  }, [checkNew]);

  const markAllRead = useCallback(async () => {
    try {
      const { alertAPI } = await import("../api");
      await alertAPI.markAllRead();
      setAlerts(prev => prev.map(a => ({ ...a, read: true })));
      setUnread(0);
    } catch(e) {}
  }, []);

  return { alerts, unread, markAllRead, setAlerts };
}
