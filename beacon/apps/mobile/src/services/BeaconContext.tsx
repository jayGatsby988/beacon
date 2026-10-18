import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type PropsWithChildren,
} from "react";
import { BeaconService } from "./BeaconService";
const Context = createContext<BeaconService | null>(null);
export function BeaconProvider({ children }: PropsWithChildren) {
  const [service] = useState(() => new BeaconService());
  useEffect(() => {
    void service.initialize();
    return () => service.scheduleDispose();
  }, [service]);
  return <Context.Provider value={service}>{children}</Context.Provider>;
}
export function useBeacon() {
  const service = useContext(Context);
  if (!service) throw new Error("BeaconProvider is missing.");
  return useSyncExternalStore(
    service.subscribe,
    service.snapshot,
    service.snapshot,
  );
}
