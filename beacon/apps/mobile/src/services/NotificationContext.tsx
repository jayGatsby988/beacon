import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from "react";
import { Alert, AppState, Platform } from "react-native";
import { router, useRootNavigationState } from "expo-router";
import * as Notifications from "expo-notifications";
import Storage from "expo-sqlite/kv-store";
import { useBeacon } from "./BeaconContext";
import { HelpAlertCoordinator, parseHelpAlertData, type AlertPermission, type HelpAlert } from "./NotificationPolicy";

const CHANNEL = "beacon-help";
const nativePort = {
  async permission(request: boolean): Promise<AlertPermission> {
    if (Platform.OS !== "ios" && Platform.OS !== "android") return "unavailable";
    if (Platform.OS === "android") await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: "Help requests and responses", importance: Notifications.AndroidImportance.HIGH,
      sound: "default", vibrationPattern: [0, 180, 120, 180], lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
    let permission = await Notifications.getPermissionsAsync();
    if (request && !permission.granted && permission.canAskAgain) {
      permission = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
    }
    if (permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return "granted";
    return permission.status === "undetermined" ? "undetermined" : "denied";
  },
  async present(alert: HelpAlert) {
    await Notifications.scheduleNotificationAsync({
      identifier: `beacon:${alert.groupId ?? "public"}:${alert.key}`,
      content: {
        title: alert.title, body: alert.body, sound: "default",
        data: { beaconAlert: 1, requestId: alert.requestId, groupId: alert.groupId },
      },
      trigger: Platform.OS === "android" ? { channelId: CHANNEL } : null,
    });
  },
};
interface NotificationState {
  ready: boolean;
  enabled: boolean;
  permission: AlertPermission;
  error?: string;
  setEnabled(enabled: boolean): Promise<void>;
}
const Context = createContext<NotificationState | null>(null);
export function useHelpNotifications() {
  const context = useContext(Context);
  if (!context) throw new Error("NotificationProvider is missing.");
  return context;
}
export function NotificationProvider({ children }: PropsWithChildren) {
  const beacon = useBeacon();
  const latest = useRef(beacon); latest.current = beacon;
  const nav = useRootNavigationState();
  const coordinator = useRef<HelpAlertCoordinator | null>(null);
  const [state, setState] = useState<Omit<NotificationState, "setEnabled">>({ ready: false, enabled: false, permission: "undetermined" });
  const [pending, setPending] = useState<ReturnType<typeof parseHelpAlertData>>(null);

  useEffect(() => {
    if (Platform.OS !== "ios" && Platform.OS !== "android") {
      setState({ ready: true, enabled: false, permission: "unavailable" });
      return;
    }
    let alive = true;
    const service = new HelpAlertCoordinator(Storage, nativePort);
    coordinator.current = service;
    const refresh = () => { if (alive) setState({ ready: true, enabled: service.enabled, permission: service.permission }); };
    const failure = (error: unknown) => { if (alive) setState(s => ({ ...s, ready: true, error: error instanceof Error ? error.message : "Notifications are unavailable in this build." })); };
    // This handler only displays app-owned alerts. Unknown pushes cannot inject routes or banners.
    Notifications.setNotificationHandler({ handleNotification: async notification => {
      const owned = parseHelpAlertData(notification.request.content.data);
      const show = !!owned && owned.groupId === latest.current.activeGroupId && alive && service.enabled;
      return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
    } });
    void service.initialize().then(refresh).catch(failure);
    const response = (value: Notifications.NotificationResponse | null) => {
      if (!alive || !value || value.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const data = parseHelpAlertData(value.notification.request.content.data);
      if (data) setPending(data);
    };
    const subscription = Notifications.addNotificationResponseReceivedListener(response);
    void Notifications.getLastNotificationResponseAsync().then(response).catch(failure);
    const app = AppState.addEventListener("change", value => {
      if (value === "active") void service.checkPermission().then(refresh).catch(failure);
    });
    return () => { alive = false; service.dispose(); subscription.remove(); app.remove(); Notifications.setNotificationHandler(null); if (coordinator.current === service) coordinator.current = null; };
  }, []);

  useEffect(() => {
    const service = coordinator.current;
    if (!service || !state.ready || beacon.loading || !beacon.nodeId) return;
    const { nodeId, activeGroupId } = beacon;
    void service.observe(beacon.requests, nodeId, activeGroupId, () =>
      latest.current.nodeId === nodeId && latest.current.activeGroupId === activeGroupId,
    ).catch(error => {
      if (coordinator.current === service) setState(s => ({ ...s, error: error instanceof Error ? error.message : "Could not show a help alert." }));
    });
  }, [state.ready, beacon.loading, beacon.nodeId, beacon.activeGroupId, beacon.requests]);

  useEffect(() => {
    if (!pending || !nav?.key || beacon.loading || !beacon.setupComplete) return;
    setPending(null);
    void Notifications.clearLastNotificationResponseAsync().catch(() => {});
    if (pending.groupId !== beacon.activeGroupId) {
      router.push("/groups");
      Alert.alert("Request in another audience", "Select the audience where this request was received to view it.");
      return;
    }
    router.push({ pathname: "/request/[id]", params: { id: pending.requestId } });
  }, [pending, nav?.key, beacon.loading, beacon.setupComplete, beacon.activeGroupId]);

  const setEnabled = useCallback(async (enabled: boolean) => {
    const service = coordinator.current;
    if (!service) throw new Error("Notifications are still opening.");
    await service.setEnabled(enabled);
    if (coordinator.current === service) setState({ ready: true, enabled: service.enabled, permission: service.permission });
  }, []);
  return <Context.Provider value={{ ...state, setEnabled }}>{children}</Context.Provider>;
}
