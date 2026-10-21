import { useRef, useCallback } from 'react';

/**
 * Throttle hook để giảm tần suất re-renders khi nhận updates liên tục từ agent.
 * Đảm bảo callback chỉ chạy tối đa 1 lần trong khoảng thời gian delay.
 */
export function useThrottle<T extends (...args: any[]) => void>(
  callback: T,
  delay: number,
): T {
  const lastRun = useRef(Date.now());
  const timeoutRef = useRef<number | null>(null);

  return useCallback(
    ((...args: any[]) => {
      const now = Date.now();
      const timeSinceLastRun = now - lastRun.current;

      if (timeSinceLastRun >= delay) {
        lastRun.current = now;
        callback(...args);
      } else {
        // Schedule để chạy sau khi delay hết
        if (timeoutRef.current !== null) {
          window.clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = window.setTimeout(() => {
          lastRun.current = Date.now();
          callback(...args);
          timeoutRef.current = null;
        }, delay - timeSinceLastRun);
      }
    }) as T,
    [callback, delay],
  );
}
