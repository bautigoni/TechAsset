import { useEffect } from 'react';

export function useAutoRefresh(callback: () => void, seconds = 5) {
  useEffect(() => {
    const id = window.setInterval(callback, seconds * 1000);
    return () => window.clearInterval(id);
  }, [callback, seconds]);
}
