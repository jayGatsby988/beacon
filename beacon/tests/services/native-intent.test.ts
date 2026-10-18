import test from "node:test";
import assert from "node:assert/strict";
import { redirectSystemPath } from "../../apps/mobile/app/+native-intent.js";

const requestId = "abc123".repeat(10) + "abcd";
test("cold and warm native links preserve supported routes", () => {
  for (const initial of [true, false])
    for (const route of [
      "/",
      "/nearby",
      "/network",
      "/history",
      "/settings",
      "/setup",
    ]) {
      assert.equal(redirectSystemPath({ path: route, initial }), route);
      assert.equal(
        redirectSystemPath({ path: `beacon://${route.slice(1)}`, initial }),
        route,
      );
      assert.equal(
        redirectSystemPath({ path: `beacon://${route}`, initial }),
        route,
      );
    }
});
test("legacy SOS links land on Help without opening a separate details screen", () => {
  for (const initial of [true, false]) {
    for (const path of [`/request/${requestId}`, `beacon://request/${requestId}`]) {
      assert.equal(redirectSystemPath({ path, initial }), "/");
    }
  }
});
test("malformed, encoded and query-based links never reach the downstream URI decoder", () => {
  for (const path of [
    "beacon://history?x=%",
    "beacon://history?x=ok",
    "/history#section",
    "/request/%FF%FE",
    "/request/%252525",
    "/history%2f..",
    "/history\u0000",
    "/history\n",
    "/history\\settings",
    "/%E0%A4%A",
  ]) {
    for (const initial of [true, false])
      assert.equal(redirectSystemPath({ path, initial }), "/");
  }
});
test("unknown schemes, authorities, paths and invalid request IDs fail closed to home", () => {
  for (const path of [
    "https://evil.test/history",
    "javascript:alert(1)",
    "beacon://evil.test/history",
    "//history",
    "/history/../settings",
    "/(tabs)/nearby",
    "/request/short",
    `/request/${"F".repeat(64)}`,
    `/request/${"a".repeat(65)}`,
  ])
    assert.equal(redirectSystemPath({ path, initial: false }), "/");
});
test("oversized hostile links are rejected before processing their encoded content", () => {
  assert.equal(
    redirectSystemPath({
      path: "beacon://history?" + "%EF%BF%BD".repeat(100000),
      initial: true,
    }),
    "/",
  );
  assert.equal(
    redirectSystemPath({
      path: "/request/" + "a".repeat(10000),
      initial: false,
    }),
    "/",
  );
});
