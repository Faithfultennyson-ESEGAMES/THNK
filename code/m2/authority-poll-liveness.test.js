const {
  delayAuthorityPoll,
  startAuthorityHeartbeat,
  withAuthoritySessionTimeout,
} = require("../../scripts/m2/runtime/authority-poll-liveness.cjs");

test("an idle Authority keeps its next claim poll referenced", async () => {
  let scheduled;
  const waiting = delayAuthorityPoll(250, (callback, milliseconds) => {
    scheduled = { callback, milliseconds };
    return { unref: jest.fn() };
  });

  expect(scheduled.milliseconds).toBe(250);
  scheduled.callback();
  await waiting;
});

test("the development registration heartbeat remains referenced", () => {
  const timer = { unref: jest.fn() };
  const heartbeat = jest.fn();
  const scheduled = jest.fn(() => timer);

  expect(startAuthorityHeartbeat(heartbeat, 15_000, scheduled)).toBe(timer);
  expect(scheduled).toHaveBeenCalledWith(heartbeat, 15_000);
  expect(timer.unref).not.toHaveBeenCalled();
});

test("a session start that never settles is bounded instead of hanging the poll loop", async () => {
  let fire;
  const cleared = [];
  const attempt = withAuthoritySessionTimeout(
    () => new Promise(() => {}),
    20_000,
    (callback) => {
      fire = callback;
      return "timer";
    },
    (timer) => cleared.push(timer)
  );

  fire();

  await expect(attempt).rejects.toMatchObject({ code: "session_start_timeout" });
  expect(cleared).toEqual(["timer"]);
});

test("a session that starts in time keeps its result and cancels the bound", async () => {
  const cleared = [];
  await expect(
    withAuthoritySessionTimeout(
      async () => "ready",
      20_000,
      () => "timer",
      (timer) => cleared.push(timer)
    )
  ).resolves.toBe("ready");
  expect(cleared).toEqual(["timer"]);
});

test("a failing session start surfaces its own error, not the timeout", async () => {
  await expect(
    withAuthoritySessionTimeout(
      async () => {
        throw Object.assign(new Error("prepare failed"), { code: "prepare_failed" });
      },
      20_000,
      () => "timer",
      () => {}
    )
  ).rejects.toMatchObject({ code: "prepare_failed" });
});
