import "tests-utils/gdjs-mock";
import {
  getCurrentPlayerID,
  popPlayerVariableChange,
  releasePlayerContext,
  resetPlayerContexts,
  setCurrentPlayerVariable,
  setPlayerDocument,
  switchPlayerContext,
} from "server/PlayerContext";
import { getServerTimestamp } from "server/ServerTime";

const variable = (value: unknown) => {
  const wrapped = new gdjs.Variable();
  wrapped.fromJSObject(value);
  return wrapped;
};

beforeEach(() => resetPlayerContexts());

test("server timestamp is the authority's own epoch clock in milliseconds", () => {
  const before = Date.now();
  const stamp = getServerTimestamp();
  expect(stamp).toBeGreaterThanOrEqual(before);
  expect(stamp).toBeLessThanOrEqual(Date.now());
});

test("a watched field fires exactly once per actual own-write change", () => {
  setPlayerDocument("alice", { progression: { xp: 7 } });
  switchPlayerContext("alice");
  expect(popPlayerVariableChange("progression.xp")).toBe(false);
  setCurrentPlayerVariable("progression.xp", variable(8));
  expect(popPlayerVariableChange("progression.xp")).toBe(true);
  expect(getCurrentPlayerID()).toBe("alice");
  expect(popPlayerVariableChange("progression.xp")).toBe(false);
  setCurrentPlayerVariable("progression.xp", variable(8));
  expect(popPlayerVariableChange("progression.xp")).toBe(false);
});

test("load-triggered changes fire and pick the changed player", () => {
  setPlayerDocument("alice", { progression: { xp: 1 } });
  setPlayerDocument("bob", { progression: { xp: 5 } });
  switchPlayerContext("alice");
  expect(popPlayerVariableChange("progression.xp")).toBe(false);
  setPlayerDocument("bob", { progression: { xp: 6 } });
  expect(popPlayerVariableChange("progression.xp")).toBe(true);
  expect(getCurrentPlayerID()).toBe("bob");
  expect(popPlayerVariableChange("progression.xp")).toBe(false);
});

test("unwatched fields never enqueue and the first load is not a change", () => {
  setPlayerDocument("cara", { score: 10, title: "novice" });
  switchPlayerContext("cara");
  expect(popPlayerVariableChange("score")).toBe(false);
  setPlayerDocument("cara", { score: 10, title: "veteran" });
  expect(popPlayerVariableChange("score")).toBe(false);
  expect(popPlayerVariableChange("title")).toBe(false);
  setPlayerDocument("cara", { score: 10, title: "legend" });
  expect(popPlayerVariableChange("title")).toBe(true);
});

test("releasing a player drops their pending changes", () => {
  setPlayerDocument("dora", { score: 1 });
  switchPlayerContext("dora");
  expect(popPlayerVariableChange("score")).toBe(false);
  setCurrentPlayerVariable("score", variable(2));
  releasePlayerContext("dora");
  expect(popPlayerVariableChange("score")).toBe(false);
});
