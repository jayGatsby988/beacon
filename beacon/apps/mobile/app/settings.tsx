import { useRef, useState, type ReactNode } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  Switch,
  View,
} from "react-native";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useBeacon } from "../src/services/BeaconContext";
import {
  Body,
  Button,
  Card,
  ErrorNotice,
  Field,
  Row,
  Screen,
  TextButton,
  formatReportTime,
  useAction,
} from "../src/components/ui";
import { colors as c } from "../src/theme/tokens";
function SettingsSection({
  title,
  summary,
  children,
}: {
  title: string;
  summary?: string;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={summary ? `${title}, ${summary}` : title}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={{
          minHeight: 48,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}
      >
        <View style={{ flex: 1, gap: 4 }}>
          <Body>{title}</Body>
          {summary && (
            <Body muted style={{ fontSize: 13 }}>
              {summary}
            </Body>
          )}
        </View>
        {expanded ? (
          <ChevronUp color={c.secondary} size={20} />
        ) : (
          <ChevronDown color={c.secondary} size={20} />
        )}
      </Pressable>
      {expanded && <View style={{ gap: 12 }}>{children}</View>}
    </Card>
  );
}
export default function Settings() {
  const b = useBeacon();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(b.displayName);
  const [cloudUrl, setCloudUrl] = useState("");
  const [incidentId, setIncidentId] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [mapStyleUrl, setMapStyleUrl] = useState("");
  const [saved, setSaved] = useState(false);
  const hasChanges =
    name !== b.displayName ||
    !!cloudUrl.trim() ||
    !!incidentId.trim() ||
    !!accessToken.trim() ||
    !!mapStyleUrl.trim();
  const action = useAction();
  const cancelMapAction = useAction();
  const mapGeneration = useRef(0);
  const mapBusyRef = useRef(false);
  const [mapBusy, setMapBusy] = useState(false);
  const [mapError, setMapError] = useState<string>();
  const runMap = async (operation: () => Promise<void>) => {
    if (mapBusyRef.current) return;
    mapBusyRef.current = true;
    const generation = ++mapGeneration.current;
    setMapBusy(true);
    setMapError(undefined);
    try {
      await operation();
    } catch (error) {
      if (generation === mapGeneration.current)
        setMapError(
          error instanceof Error
            ? error.message
            : "The map could not be prepared. Please try again.",
        );
    } finally {
      if (generation === mapGeneration.current) {
        mapBusyRef.current = false;
        setMapBusy(false);
      }
    }
  };
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <Screen
        back
        title="Settings"
        footer={
          hasChanges ? (
            <View
              style={{
                paddingHorizontal: 20,
                paddingTop: 10,
                paddingBottom: Math.max(insets.bottom, 12),
                gap: 8,
                borderTopWidth: 1,
                borderTopColor: c.border,
                backgroundColor: c.background,
              }}
            >
              <Button
                busy={action.busy}
                onPress={() =>
                  action.run(async () => {
                    await b.saveSettings({
                      displayName: name.trim() || "Participant",
                      ...(cloudUrl.trim() ? { cloudUrl: cloudUrl.trim() } : {}),
                      ...(incidentId.trim()
                        ? { incidentId: incidentId.trim() }
                        : {}),
                      ...(accessToken.trim()
                        ? { accessToken: accessToken.trim() }
                        : {}),
                      ...(mapStyleUrl.trim()
                        ? { mapStyleUrl: mapStyleUrl.trim() }
                        : {}),
                    });
                    setName(name.trim() || "Participant");
                    setSaved(true);
                    setCloudUrl("");
                    setIncidentId("");
                    setAccessToken("");
                    setMapStyleUrl("");
                  })
                }
              >
                Save changes
              </Button>
            </View>
          ) : undefined
        }
      >
        <ErrorNotice message={action.error} />
        <Card>
          <Field
            label="Your name"
            value={name}
            onChangeText={(value) => {
              setName(value);
              setSaved(false);
            }}
            maxLength={40}
          />
          {saved && !hasChanges && <Body muted>Saved.</Body>}
        </Card>
        <Card>
          <View style={{ flexDirection: "row", gap: 16, alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <Body>Nearby sharing</Body>
            </View>
            <Switch
              accessibilityLabel="Enable nearby sharing"
              value={b.relayEnabled}
              onValueChange={(value) =>
                action.run(() => b.setRelayEnabled(value))
              }
              trackColor={{ false: c.border, true: c.secondary }}
              thumbColor={c.text}
            />
          </View>
        </Card>
        <Card>
          <TextButton onPress={() => router.push("/history")}>
            History
          </TextButton>
          <TextButton onPress={() => router.push("/network")}>
            Connection status
          </TextButton>
        </Card>
        <SettingsSection title="Permissions">
          <Row
            label="Bluetooth"
            value={
              b.bluetooth === "poweredOn"
                ? "Available"
                : b.bluetooth === "unauthorized"
                  ? "Permission denied"
                  : b.bluetooth === "poweredOff"
                    ? "Off"
                    : b.bluetooth === "unsupported"
                      ? "Unavailable in this build"
                      : "Unknown"
            }
          />
          <Row label="Location permission" value={b.locationPermission} />
          <TextButton onPress={() => action.run(b.requestPermissions)}>
            Allow permissions
          </TextButton>
          <TextButton onPress={() => action.run(() => Linking.openSettings())}>
            Open device settings
          </TextButton>
        </SettingsSection>
        <SettingsSection
          title="Offline map"
          summary={`${b.map.name || "UW campus"} · ${b.map.status === "downloading" ? `${Math.round(b.map.progress * 100)}%` : b.map.status}`}
        >
          {b.map.bytes != null && (
            <Row
              label="Stored size"
              value={`${(b.map.bytes / 1024 / 1024).toFixed(1)} MB`}
            />
          )}
          {b.map.updatedAt != null && (
            <Row label="Updated" value={formatReportTime(b.map.updatedAt)} />
          )}
          <Field
            label="Custom map URL"
            placeholder="https://your-provider/style.json"
            value={mapStyleUrl}
            onChangeText={setMapStyleUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Body muted style={{ fontSize: 12, lineHeight: 19 }}>
            Optional. Blank keeps the saved provider. Custom maps need internet
            and permission for offline storage.
          </Body>
          {b.map.error && <Body>{b.map.error}</Body>}
          <Button
            secondary
            busy={mapBusy || b.map.status === "downloading"}
            disabled={cancelMapAction.busy}
            onPress={() =>
              void runMap(async () => {
                if (mapStyleUrl.trim()) {
                  await b.saveSettings({
                    displayName: b.displayName,
                    mapStyleUrl: mapStyleUrl.trim(),
                  });
                  setMapStyleUrl("");
                }
                await b.downloadMap();
              })
            }
          >
            {b.map.status === "ready" ? "Update map" : "Download map"}
          </Button>
          {b.map.status === "downloading" ? (
            <Button
              secondary
              busy={cancelMapAction.busy}
              onPress={() =>
                cancelMapAction.run(async () => {
                  await b.removeMap();
                  mapGeneration.current++;
                  mapBusyRef.current = false;
                  setMapBusy(false);
                  setMapError(undefined);
                })
              }
            >
              Cancel download
            </Button>
          ) : (
            <Button
              secondary
              busy={mapBusy}
              disabled={cancelMapAction.busy}
              onPress={() =>
                void runMap(async () => {
                  await b.saveSettings({
                    displayName: b.displayName,
                    mapStyleUrl: "",
                  });
                  setMapStyleUrl("");
                  await b.downloadMap();
                })
              }
            >
              Use included UW map
            </Button>
          )}
          <ErrorNotice message={mapError || cancelMapAction.error} />
          {b.map.status === "ready" && (
            <TextButton
              onPress={() =>
                Alert.alert(
                  "Remove downloaded map?",
                  "Reported coordinates and place descriptions will remain available.",
                  [
                    { text: "Keep map", style: "cancel" },
                    {
                      text: "Remove map",
                      style: "destructive",
                      onPress: () => action.run(b.removeMap),
                    },
                  ],
                )
              }
            >
              Remove saved map
            </TextButton>
          )}
        </SettingsSection>
        <SettingsSection title="Cloud sync" summary={b.sync.status}>
          <Body muted>
            Optional uploads to an organizer include location and request
            details.
          </Body>
          <Field
            label="Server URL"
            placeholder="https://beacon.your-community.org"
            value={cloudUrl}
            onChangeText={setCloudUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Field
            label="Incident ID"
            placeholder="Provided by your organizer"
            value={incidentId}
            onChangeText={setIncidentId}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Field
            label="Incident access token"
            placeholder="Stored securely on this phone"
            value={accessToken}
            onChangeText={setAccessToken}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Body muted style={{ fontSize: 12 }}>
            Blank fields keep saved settings. Start sync from History.
          </Body>
          {b.sync.status !== "disabled" && (
            <TextButton
              onPress={() =>
                Alert.alert(
                  "Disconnect this incident?",
                  "This clears the saved server and access token on this phone. Previously uploaded events remain with the organizer. Local requests are unchanged.",
                  [
                    { text: "Keep connected", style: "cancel" },
                    {
                      text: "Disconnect",
                      style: "destructive",
                      onPress: () =>
                        action.run(async () => {
                          await b.saveSettings({
                            displayName: name.trim() || "Participant",
                            cloudUrl: "",
                            incidentId: "",
                            accessToken: "",
                          });
                          setCloudUrl("");
                          setIncidentId("");
                          setAccessToken("");
                        }),
                    },
                  ],
                )
              }
            >
              Disconnect incident
            </TextButton>
          )}
        </SettingsSection>
        <SettingsSection title="Advanced">
          <Body muted style={{ fontSize: 12 }}>
            Device {b.nodeId.slice(0, 12).toUpperCase()}
          </Body>
          <Body muted>
            Diagnostics exclude request notes, precise locations and access
            tokens.
          </Body>
          <TextButton onPress={() => action.run(b.exportDiagnostics)}>
            Export diagnostics
          </TextButton>
          <TextButton
            onPress={() =>
              Alert.alert(
                "Clear local history?",
                "This removes eligible local history. Active requests and records required to prevent stale updates must be retained.",
                [
                  { text: "Keep history", style: "cancel" },
                  {
                    text: "Clear history",
                    style: "destructive",
                    onPress: () => action.run(b.clearHistory),
                  },
                ],
              )
            }
          >
            Clear history
          </TextButton>
        </SettingsSection>
      </Screen>
    </KeyboardAvoidingView>
  );
}
