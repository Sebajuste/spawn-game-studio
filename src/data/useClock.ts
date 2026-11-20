// « il y a … » vieillit sans événement : un redessin régulier suffit.
import { useEffect, useState } from "react";

export function useClock(ms = 30_000): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(timer);
  }, [ms]);
}
