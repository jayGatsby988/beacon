import test from "node:test";
import assert from "node:assert/strict";
import { keepMapLocationFresh } from "../../apps/mobile/src/services/mapLocationRefresh.js";

test("visible map refreshes local GPS beyond its expiry without moving the camera or running in background", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let foreground = true;
  let refreshes = 0;
  let cameraFits = 0;
  let listener: (() => void) | undefined;
  const stop = keepMapLocationFresh({
    refresh: async () => { refreshes++; },
    onInitialFix: () => { cameraFits++; },
    isForeground: () => foreground,
    onForeground: (callback) => { listener = callback; return () => { listener = undefined; }; },
  });
  await Promise.resolve();
  assert.equal(refreshes, 1);
  for (let tick = 0; tick < 5; tick++) {
    t.mock.timers.tick(30_000);
    await Promise.resolve();
  }
  assert.equal(refreshes, 6, "local GPS remains current after the 120-second pin lifetime");
  assert.equal(cameraFits, 1, "periodic fixes must not undo user map pans");
  foreground = false;
  t.mock.timers.tick(120_000);
  await Promise.resolve();
  assert.equal(refreshes, 6);
  foreground = true;
  listener?.();
  await Promise.resolve();
  assert.equal(refreshes, 7, "returning to the foreground refreshes immediately");
  stop();
  assert.equal(listener, undefined);
  t.mock.timers.tick(120_000);
  assert.equal(refreshes, 7, "leaving the map stops polling");
});

test("map refresh avoids overlapping GPS requests and ignores completion after leaving the screen", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let complete!: () => void;
  let calls = 0;
  let cameraFits = 0;
  const stop = keepMapLocationFresh({
    refresh: () => { calls++; return new Promise<void>((resolve) => { complete = resolve; }); },
    onInitialFix: () => { cameraFits++; },
    isForeground: () => true,
    onForeground: () => () => {},
  });
  t.mock.timers.tick(90_000);
  assert.equal(calls, 1);
  stop();
  complete();
  await Promise.resolve();
  assert.equal(cameraFits, 0);
});

test("a failed GPS refresh can recover on the next visible-map interval", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let calls = 0;
  let cameraFits = 0;
  const stop = keepMapLocationFresh({
    refresh: async () => { if (++calls === 1) throw new Error("GPS unavailable"); },
    onInitialFix: () => { cameraFits++; },
    isForeground: () => true,
    onForeground: () => () => {},
  });
  await Promise.resolve();
  assert.equal(cameraFits, 0);
  t.mock.timers.tick(30_000);
  await Promise.resolve();
  assert.equal(calls, 2);
  assert.equal(cameraFits, 1);
  stop();
});
