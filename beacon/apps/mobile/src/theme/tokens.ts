import { Platform } from "react-native";
export const colors = {
  background: "#FFFFFF",
  card: "#F7F9F8",
  raised: "#EEF3F0",
  border: "#DDE5E1",
  text: "#082D25",
  onAction: "#FFFFFF",
  secondary: "#52616B",
  muted: "#65736E",
  red: "#CF2C20",
  alert: "#FFF4F1",
  alertBorder: "#EAC2BA",
  redLabel: "#B32318",
  connected: "#268641",
};
export const fonts = {
  headline: "InterTight-Black",
  body: "Inter-Regular",
  medium: "Inter-SemiBold",
  wordmark: "BarlowCondensed-Bold",
  fallback: Platform.select({ ios: "System", android: "sans-serif" }),
};
export const radius = { sm: 12, md: 16, lg: 24 };
export const spacing = { xs: 6, sm: 12, md: 20, lg: 28, xl: 40, xxl: 56 };
