import React, { ReactNode, useState, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  AccessibilityInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
  StyleProp,
  TextStyle,
  useWindowDimensions,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { router } from "expo-router";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  ChevronRight,
  Settings2,
} from "lucide-react-native";
import Svg, { Path } from "react-native-svg";
import { colors as c, fonts } from "../theme/tokens";
import MainHeader from "./MainHeader";
import { usePressFeedback } from "./Motion";

export function Label({
  children,
  color = c.secondary,
}: {
  children: ReactNode;
  color?: string;
}) {
  return <Text style={[styles.label, { color }]}>{children}</Text>;
}
export function Body({
  children,
  muted = false,
  style,
}: {
  children: ReactNode;
  muted?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text style={[styles.body, muted && { color: c.secondary }, style]}>
      {children}
    </Text>
  );
}
export function Heading({
  children,
  size = 28,
}: {
  children: ReactNode;
  size?: number;
}) {
  return (
    <Text
      accessibilityRole="header"
      style={[styles.heading, { fontSize: size, lineHeight: size * 1.18 }]}
    >
      {children}
    </Text>
  );
}
export function BeaconMark({
  size = 30,
  color = c.text,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      accessibilityElementsHidden
    >
      <Path d="M24 6 7 39h10l7-14 7 14h10L24 6Z" fill={color} />
      <Path d="m24 31 5 5-5 5-5-5Z" fill={color} />
    </Svg>
  );
}
export function Brand() {
  const { width, fontScale } = useWindowDimensions();
  return (
    <View style={styles.brand}>
      {width >= 375 && fontScale <= 1.4 && <BeaconMark />}
      <Text numberOfLines={1} maxFontSizeMultiplier={1.4} style={styles.wordmark}>
        Beacon
      </Text>
    </View>
  );
}
export function TopBar({
  back,
  title,
  main = false,
  hideSettings = false,
}: {
  back?: boolean;
  title?: string;
  network?: string;
  main?: boolean;
  hideSettings?: boolean;
}) {
  if (main) return <MainHeader brand={<Brand />} />;
  return (
    <View style={styles.topBar}>
      {back ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/")
          }
          style={styles.iconButton}
        >
          <ArrowLeft size={24} color={c.text} />
        </Pressable>
      ) : title ? (
        <Text accessibilityRole="header" style={[styles.topTitle, styles.pageTitle]}>
          {title}
        </Text>
      ) : (
        <Brand />
      )}
      {back && title && <Text accessibilityRole="header" style={styles.topTitle}>{title}</Text>}
      {back || hideSettings ? (
        <View style={{ width: 48 }} />
      ) : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Settings"
            onPress={() => router.push("/settings")}
            style={styles.iconButton}
          >
            <Settings2 color={c.secondary} size={22} />
          </Pressable>
        </>
      )}
    </View>
  );
}
export function Screen({
  children,
  back = false,
  title,
  network,
  footer,
  main = false,
  hideSettings = false,
  scroll = true,
  contentStyle,
}: {
  children: ReactNode;
  back?: boolean;
  title?: string;
  network?: string;
  footer?: ReactNode;
  main?: boolean;
  hideSettings?: boolean;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      <TopBar back={back} title={title} network={network} main={main} hideSettings={hideSettings} />
      {scroll ? <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 20 + insets.bottom },
          contentStyle,
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
      >
        {children}
      </ScrollView> : <View style={[styles.content, { flex: 1, minHeight: 0, paddingBottom: 12 }, contentStyle]}>{children}</View>}
      {footer}
    </SafeAreaView>
  );
}
export function Card({
  children,
  style,
  alert = false,
}: {
  children: ReactNode;
  style?: ViewStyle;
  alert?: boolean;
}) {
  return (
    <View
      style={[
        styles.card,
        alert && { backgroundColor: c.alert, borderColor: c.alertBorder },
        style,
      ]}
    >
      {children}
    </View>
  );
}
export function Divider() {
  return <View style={styles.divider} />;
}
export function Button({
  children,
  onPress,
  secondary = false,
  busy = false,
  disabled = false,
  icon = true,
}: {
  children: ReactNode;
  onPress: () => void;
  secondary?: boolean;
  busy?: boolean;
  disabled?: boolean;
  icon?: boolean;
}) {
  const motion = usePressFeedback();
  return (
    <Animated.View style={motion.style}>
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      onPress={onPress}
      onPressIn={motion.onPressIn}
      onPressOut={motion.onPressOut}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondaryButton,
        (disabled || busy) && { opacity: 0.5 },
        pressed && { opacity: 0.75 },
      ]}
    >
      <Text
        style={[styles.buttonText, { color: secondary ? c.text : c.onAction }]}
      >
        {children}
      </Text>
      {busy ? (
        <ActivityIndicator color={c.text} />
      ) : icon ? (
          <ArrowRight size={21} color={secondary ? c.text : c.onAction} />
      ) : null}
    </Pressable>
    </Animated.View>
  );
}
export function TextButton({
  children,
  onPress,
}: {
  children: ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.textButton, pressed && { opacity: 0.6 }]}
    >
      <Text style={styles.textButtonText}>{children}</Text>
      <ChevronRight color={c.secondary} size={20} />
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 10 }}>
      <Label>{label}</Label>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.muted}
        selectionColor={c.redLabel}
        {...props}
        style={[
          styles.input,
          props.multiline && { minHeight: 112, textAlignVertical: "top" },
          props.style,
        ]}
      />
    </View>
  );
}
export function Pill({
  children,
  selected,
  onPress,
}: {
  children: ReactNode;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.pill,
        selected && { backgroundColor: c.text, borderColor: c.text },
      ]}
    >
      <Text style={[styles.pillText, selected && { color: c.background }]}>
        {children}
      </Text>
    </Pressable>
  );
}
export function Row({ label, value }: { label: string; value: string }) {
  const { fontScale, width } = useWindowDimensions();
  const stacked = fontScale >= 1.5 || width < 350;
  return (
    <View style={[styles.row, stacked && { flexDirection: "column", gap: 6 }]}>
      <Body muted style={{ flexShrink: 1 }}>
        {label}
      </Body>
      <Body style={{ textAlign: stacked ? "left" : "right", flexShrink: 1 }}>
        {value}
      </Body>
    </View>
  );
}
export function StatusLine({
  complete,
  title,
  detail,
}: {
  complete: boolean;
  title: string;
  detail?: string;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${complete ? "Confirmed: " : ""}${title}${detail ? `. ${detail}` : ""}`}
      style={styles.statusLine}
    >
      <View
        style={[
          styles.statusDot,
          complete && { backgroundColor: c.text, borderColor: c.text },
        ]}
      >
        {complete ? (
          <Check size={13} color={c.background} />
        ) : (
          <View
            style={{
              width: 4,
              height: 4,
              borderRadius: 2,
              backgroundColor: c.muted,
            }}
          />
        )}
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[styles.smallTitle, !complete && { color: c.secondary }]}>
          {title}
        </Text>
        {detail && <Text style={styles.caption}>{detail}</Text>}
      </View>
    </View>
  );
}
export function ErrorNotice({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.errorNotice}>
      <CircleAlert size={18} color={c.secondary} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}
export function useAction() {
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string>();
  const run = async (action: () => Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : "This action could not be completed. Please try again.";
      setError(message);
      AccessibilityInfo.announceForAccessibility(message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return { busy, error, run };
}
export const formatTime = (at?: number) =>
  at
    ? new Date(at).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    : "Not recorded";
export const formatReportTime = (at?: number) =>
  at
    ? new Date(at).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Unknown capture time";
export const age = (at: number) => {
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000));
  return minutes < 1
    ? "Just now"
    : minutes < 60
      ? `${minutes}m ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : new Date(at).toLocaleDateString([], {
            month: "short",
            day: "numeric",
          });
};
export const styles = StyleSheet.create({
  errorNotice: { flexDirection: "row", alignItems: "flex-start", gap: 9, paddingVertical: 8 },
  errorText: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 21, color: c.secondary },
  screen: { flex: 1, backgroundColor: c.background },
  content: {
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    gap: 20,
  },
  topBar: {
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
    minHeight: 72,
    paddingVertical: 8,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1, minWidth: 0 },
  wordmark: {
    flexShrink: 1,
    fontFamily: fonts.headline,
    fontSize: 28,
    letterSpacing: -0.9,
    color: c.text,
  },
  topTitle: {
    fontFamily: fonts.medium,
    fontSize: 16,
    color: c.text,
    flex: 1,
    textAlign: "center",
  },
  pageTitle: {
    textAlign: "left",
    paddingLeft: 6,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.8,
  },
  iconButton: {
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  networkChip: {
    minWidth: 48,
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    minHeight: 48,
    paddingHorizontal: 8,
  },
  chipText: { fontSize: 12, color: c.secondary, fontFamily: fonts.medium },
  heading: {
    fontFamily: fonts.headline,
    color: c.text,
    letterSpacing: -0.7,
    flexShrink: 1,
  },
  label: {
    flexShrink: 1,
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 19,
  },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 24, color: c.text },
  caption: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: c.secondary,
  },
  smallTitle: {
    fontFamily: fonts.medium,
    fontSize: 16,
    lineHeight: 23,
    color: c.text,
  },
  card: {
    backgroundColor: c.card,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    gap: 12,
  },
  divider: { height: 1, backgroundColor: c.border },
  button: {
    backgroundColor: c.red,
    borderRadius: 16,
    minHeight: 56,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  secondaryButton: {
    backgroundColor: c.raised,
    borderWidth: 1,
    borderColor: c.border,
  },
  buttonText: {
    fontFamily: fonts.medium,
    color: c.text,
    fontSize: 17,
    flexShrink: 1,
  },
  textButton: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  textButtonText: {
    fontFamily: fonts.medium,
    color: c.secondary,
    fontSize: 15,
    flexShrink: 1,
  },
  input: {
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: 14,
    padding: 16,
    color: c.text,
    fontFamily: fonts.body,
    fontSize: 16,
    minHeight: 54,
  },
  pill: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: c.border,
    paddingVertical: 13,
    paddingHorizontal: 17,
    justifyContent: "center",
  },
  pillText: { fontFamily: fonts.medium, color: c.secondary, fontSize: 14 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 20,
    alignItems: "flex-start",
  },
  statusLine: { flexDirection: "row", gap: 13, alignItems: "flex-start" },
  statusDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: c.muted,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
});
