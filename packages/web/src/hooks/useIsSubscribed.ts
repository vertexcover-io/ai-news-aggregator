import { useEffect, useState } from "react";
import { readSubscribed } from "../lib/subscriptionStorage";

export function useIsSubscribed(): boolean {
  const [subscribed, setSubscribed] = useState<boolean>(() => readSubscribed());

  useEffect(() => {
    const sync = (): void => {
      setSubscribed(readSubscribed());
    };
    window.addEventListener("storage", sync);
    window.addEventListener("newsletter-subscription-change", sync);
    return (): void => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("newsletter-subscription-change", sync);
    };
  }, []);

  return subscribed;
}
