import { Platform } from "react-native";
export const colors = {
  background: "#111317",
  card: "#191C22",
  raised: "#20242B",
  border: "#2A2E36",
  text: "#F5F5F4",
  onAction: "#FFFFFF",
  secondary: "#B3B7BF",
  muted: "#8C929E",
  red: "#D23A3A",
  alert: "#2A1519",
  alertBorder: "#C2393B",
  redLabel: "#F07070",
};
export const fonts = {
  headline: "InterTight-Black",
  body: "Inter-Regular",
  medium: "Inter-SemiBold",
  wordmark: "BarlowCondensed-Bold",
  fallback: Platform.select({ ios: "System", android: "sans-serif" }),
};
export const radius = { sm: 12, md: 20, lg: 28 };
export const spacing = { xs: 6, sm: 12, md: 20, lg: 28, xl: 40, xxl: 56 };
