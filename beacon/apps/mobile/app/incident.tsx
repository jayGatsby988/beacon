import { useState } from "react";
import { Alert, Text } from "react-native";
import { router } from "expo-router";
import { useBeacon } from "../src/services/BeaconContext";
import { validatedCloudUrl } from "../src/services/ServicePolicy";
import { Body, Button, Card, ErrorNotice, Field, Label, Screen, styles, useAction } from "../src/components/ui";
import type { BeaconState } from "../src/ui/types";

export default function IncidentConnection() {
  const b = useBeacon();
  return (
    <Screen back title="Incident connection">
      {b.loading ? <Body muted>Opening saved settings…</Body> : (
        <ConnectionForm beacon={b} />
      )}
    </Screen>
  );
}

function ConnectionForm({ beacon: b }: { beacon: BeaconState }) {
  const [url, setUrl] = useState(b.cloudConnection.url);
  const [incidentId, setIncidentId] = useState(b.cloudConnection.incidentId);
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState(false);
  const action = useAction();
  const connected = Boolean(b.cloudConnection.url);
  const busy = action.busy || b.sync.status === "syncing";
  const save = async () => {
    const cloudUrl = validatedCloudUrl(url.trim());
    const id = incidentId.trim();
    const accessToken = token.trim();
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id))
      throw new Error("Use the incident ID supplied by its organizer: up to 80 letters, numbers, underscores or hyphens.");
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(accessToken))
      throw new Error("Enter the access token issued for this phone.");
    await b.saveSettings({ displayName: b.displayName, cloudUrl, incidentId: id, accessToken });
    setUrl(cloudUrl);
    setIncidentId(id);
    setToken("");
    setSaved(true);
  };
  const disconnect = () => Alert.alert(
    "Disconnect this incident?",
    `Remove this phone’s saved connection and access token. Local requests and ${b.sync.pendingCount} pending uploads stay saved. Records already uploaded remain on the server.`,
    [
      { text: "Cancel", style: "cancel" },
      { text: "Disconnect", style: "destructive", onPress: () => { void action.run(async () => {
        await b.saveSettings({ displayName: b.displayName, cloudUrl: "", incidentId: "", accessToken: "" });
        setUrl("");
        setIncidentId("");
        setToken("");
        setSaved(false);
      }); } },
    ],
  );
  return (
    <>
      <Body muted>
        Optional shared history for Nearby SOS activity. Private-group requests and direct messages stay out of cloud uploads.
      </Body>
      <Card>
        <Label>This phone’s enrollment ID</Label>
        <Text selectable accessibilityLabel={`Enrollment ID: ${b.nodeId}`} style={styles.caption}>{b.nodeId}</Text>
        <Body muted>Give this ID to the incident organizer to receive a token for this phone.</Body>
      </Card>
      <Card>
        <Field label="HTTPS server URL" value={url} onChangeText={(value) => { setUrl(value); setSaved(false); }} placeholder="https://beacon.example.org" autoCapitalize="none" autoCorrect={false} keyboardType="url" maxLength={2048} editable={!busy} />
        <Field label="Incident ID" value={incidentId} onChangeText={(value) => { setIncidentId(value); setSaved(false); }} placeholder="ID from your organizer" autoCapitalize="none" autoCorrect={false} maxLength={80} editable={!busy} />
        <Field label={connected ? "New access token" : "Access token"} value={token} onChangeText={(value) => { setToken(value); setSaved(false); }} secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" textContentType="none" maxLength={128} editable={!busy} />
        {connected && <Body muted>Saved tokens are never displayed. Enter a new token to update this connection.</Body>}
        <Body muted>Saving does not upload. Open History and choose Sync recorded events when you are ready.</Body>
        <Button busy={action.busy} disabled={busy || !url.trim() || !incidentId.trim() || !token.trim()} onPress={() => action.run(save)}>Save connection</Button>
      </Card>
      <ErrorNotice message={action.error} />
      {saved && <Body>Connection saved.</Body>}
      {b.sync.status === "syncing" && <Body muted>Wait for the current sync to finish before changing this connection.</Body>}
      {connected && <Button secondary onPress={() => router.push("/history")}>Open History</Button>}
      {connected && <Button secondary disabled={busy} onPress={disconnect}>Disconnect incident</Button>}
    </>
  );
}
