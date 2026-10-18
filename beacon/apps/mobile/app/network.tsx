import { Linking, Text, View } from "react-native";
import Svg, { Circle, Line, Text as SvgText } from "react-native-svg";
import { useBeacon } from "../src/services/BeaconContext";
import {
  Body,
  Button,
  Card,
  Divider,
  ErrorNotice,
  Label,
  Row,
  Screen,
  age,
  useAction,
  styles,
} from "../src/components/ui";
import { colors as c, fonts } from "../src/theme/tokens";
import { PeerView } from "../src/ui/types";
function NetworkDiagram({ peers }: { peers: PeerView[] }) {
  const shown = peers.filter((p) => p.state !== "disconnected").slice(0, 8);
  const nodes = shown.map((p, i) => ({
    ...p,
    x: 150 + 103 * Math.cos(-Math.PI / 2 + i * ((Math.PI * 2) / shown.length)),
    y: 120 + 82 * Math.sin(-Math.PI / 2 + i * ((Math.PI * 2) / shown.length)),
  }));
  return (
    <View
      accessible
      accessibilityLabel={`${shown.length} Bluetooth sessions shown. Solid lines are current connections. Dotted lines are discovered sessions, not connected. Sessions are not unique people or phones.`}
      style={{ alignItems: "center" }}
    >
      <Svg width="100%" height={160} viewBox="0 0 300 240">
        <Circle
          cx={150}
          cy={120}
          r={82}
          stroke={c.border}
          strokeDasharray="3 7"
          fill="none"
        />
        {nodes.map((p) => (
          <Line
            key={`line-${p.id}`}
            x1={150}
            y1={120}
            x2={p.x}
            y2={p.y}
            stroke={p.state === "connected" ? c.secondary : c.border}
            strokeWidth={1}
            strokeDasharray={p.state === "connected" ? undefined : "4 5"}
          />
        ))}
        <Circle cx={150} cy={120} r={29} fill={c.text} />
        <SvgText
          x={150}
          y={125}
          textAnchor="middle"
          fontSize={12}
          fill={c.background}
          fontWeight="bold"
        >
          YOU
        </SvgText>
        {nodes.map((p) => (
          <Circle
            key={p.id}
            cx={p.x}
            cy={p.y}
            r={13}
            fill={p.state === "connected" ? c.text : c.card}
            stroke={p.state === "connected" ? c.text : c.secondary}
            strokeWidth={1.5}
          />
        ))}
      </Svg>
    </View>
  );
}
export default function Network() {
  const b = useBeacon();
  const action = useAction();
  const connected = b.peers.filter((p) => p.state === "connected").length;
  return (
    <Screen back title="Connection">
      <Body muted>Keep Beacon open to send, receive and relay requests.</Body>
      <Card style={{ padding: 20, gap: 12 }}>
        <NetworkDiagram peers={b.peers} />
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-around",
            gap: 12,
          }}
        >
          <View style={{ flex: 1, gap: 5, alignItems: "center" }}>
            <Text
              style={{
                fontFamily: fonts.headline,
                fontSize: 26,
                color: c.text,
              }}
            >
              {connected}
            </Text>
            <Label>Connected links</Label>
          </View>
          <View style={{ width: 1, backgroundColor: c.border }} />
          <View style={{ flex: 1, gap: 5, alignItems: "center" }}>
            <Text
              style={{
                fontFamily: fonts.headline,
                fontSize: 26,
                color: c.text,
              }}
            >
              {b.queueCount}
            </Text>
            <Label>Queued</Label>
          </View>
        </View>
        <Divider />
        <Body muted style={{ fontSize: 13, lineHeight: 20 }}>
          {connected
            ? "Solid: connected. Dotted: discovered. One phone can have multiple links; positions do not show distance."
            : "No connected links. Saved requests will wait for a connection."}
        </Body>
      </Card>
      <Card>
        <Row
          label="Bluetooth"
          value={
            b.bluetooth === "poweredOn"
              ? "Available"
              : b.bluetooth === "poweredOff"
                ? "Turn on Bluetooth"
                : b.bluetooth === "unauthorized"
                  ? "Permission needed"
                  : b.bluetooth === "unsupported"
                    ? "Unavailable"
                    : "Checking availability"
          }
        />
        <Row
          label="Nearby sharing"
          value={
            b.relayRunning
              ? "Running"
              : b.relayEnabled
                ? "Waiting to start"
                : "Paused"
          }
        />
        <Row
          label="Internet"
          value={
            b.internet === null
              ? "Unknown"
              : b.internet
                ? "Connected"
                : "Offline"
          }
        />
        <Divider />
        <Body muted>
          Cloud upload does not confirm delivery to another phone.
        </Body>
      </Card>
      {b.bluetooth !== "poweredOn" && b.bluetooth !== "unsupported" && (
        <Button
          busy={action.busy}
          onPress={() =>
            action.run(
              b.bluetooth === "unauthorized" || b.bluetooth === "poweredOff"
                ? () => Linking.openSettings()
                : b.requestPermissions,
            )
          }
        >
          {b.bluetooth === "poweredOff"
            ? "Open device settings"
            : b.bluetooth === "unauthorized"
              ? "Open permission settings"
              : "Check permissions"}
        </Button>
      )}
      {b.bluetooth === "unsupported" && (
        <Card>
          <Label>Bluetooth unavailable here</Label>
          <Body muted>
            This device or build can save requests but cannot share them over
            Bluetooth.
          </Body>
        </Card>
      )}
      <Button
        secondary
        busy={action.busy}
        disabled={!b.relayEnabled && b.bluetooth === "unsupported"}
        onPress={() => action.run(() => b.setRelayEnabled(!b.relayEnabled))}
      >
        {b.relayEnabled ? "Pause nearby sharing" : "Enable nearby sharing"}
      </Button>
      <ErrorNotice message={action.error || b.error} />
      <Label>Bluetooth links</Label>
      {b.peers.length ? (
        b.peers.map((p) => (
          <Card key={p.id}>
            <View
              style={{
                flexDirection: "row",
                gap: 16,
                justifyContent: "space-between",
              }}
            >
              <Text style={[styles.smallTitle, { flex: 1 }]}>
                {p.name || `Link ${p.id.slice(0, 6).toUpperCase()}`}
              </Text>
              <Label>{p.state}</Label>
            </View>
            <Body muted>Last seen {age(p.lastSeenAt)}</Body>
          </Card>
        ))
      ) : (
        <Body muted>No links discovered yet.</Body>
      )}
      <Body muted style={{ fontSize: 12, lineHeight: 19 }}>
        Local links only. Background and locked-screen relaying are not
        guaranteed.
      </Body>
    </Screen>
  );
}
