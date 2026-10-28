import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import type { DailyPlan } from '@workspace/api-client-react';
import { isDailyPlanCurrent } from '@/lib/daily-brief';

const safeScope = (scope: string) => scope.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 160) || 'signed-out';

export function useCachedDailyPlan(scope: string | null, remotePlan: DailyPlan | undefined) {
  const [cachedPlan, setCachedPlan] = useState<DailyPlan>();
  const [hydrated, setHydrated] = useState(false);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const key = scope ? `farm-planner-mobile-daily-plan:${safeScope(scope)}` : null;

  useEffect(() => {
    if (!key) {
      setCachedPlan(undefined);
      setHydrated(false);
      setHydratedKey(null);
      return;
    }
    let active = true;
    setHydrated(false);
    void AsyncStorage.getItem(key).then((saved) => {
      if (!active) return;
      if (saved) {
        try {
          const plan = JSON.parse(saved) as DailyPlan;
          if (isDailyPlanCurrent(plan)) setCachedPlan(plan);
          else {
            setCachedPlan(undefined);
            void AsyncStorage.removeItem(key);
          }
        } catch { setCachedPlan(undefined); }
      } else {
        setCachedPlan(undefined);
      }
      setHydrated(true);
      setHydratedKey(key);
    });
    return () => { active = false; };
  }, [key]);

  useEffect(() => {
    if (!key || !remotePlan || !isDailyPlanCurrent(remotePlan)) return;
    setCachedPlan(remotePlan);
    setHydrated(true);
    setHydratedKey(key);
    void AsyncStorage.setItem(key, JSON.stringify(remotePlan));
  }, [key, remotePlan]);

  return {
    plan: remotePlan ?? cachedPlan,
    hydrated,
    readyForScope: Boolean(key && hydrated && hydratedKey === key),
    isCached: !remotePlan && Boolean(cachedPlan),
  };
}