import { useEffect, useRef, useState } from 'react';

/** Runs an action once at a time, keeping its reason; never sets state after unmount. */
export function useAction(): { busy: boolean; reason: string | null; run: (f: () => Promise<string | null>) => Promise<string | null> } {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const busyRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return {
    busy,
    reason,
    run: async (f) => {
      if (busyRef.current) return null;
      busyRef.current = true;
      setBusy(true);
      const r = await f();
      busyRef.current = false;
      if (alive.current) {
        setBusy(false);
        setReason(r);
      }
      return r;
    },
  };
}

