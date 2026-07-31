import { ClientAdapter } from "adapters/Adapter";
import { startConnectionRequestRetry } from "client/ConnectionRequestRetry";
import { setConnectionState } from "client/ClientConnectionState";

(globalThis as unknown as { gdjs: unknown }).gdjs = {
  Logger: class {
    error() {}
    warn() {}
  },
};
const { startClient, stopClient } =
  require("client/StartClient") as typeof import("client/StartClient");

class CountingAdapter extends ClientAdapter {
  sentMessages = 0;

  async prepare(): Promise<void> {}
  close(): void {}
  protected doSendMessage(): void {
    this.sentMessages++;
  }
}

test("retries the initial connection request until stopped", () => {
  jest.useFakeTimers();
  const adapter = new CountingAdapter();
  const stop = startConnectionRequestRetry(adapter, 500);

  expect(adapter.sentMessages).toBe(1);
  jest.advanceTimersByTime(1_500);
  expect(adapter.sentMessages).toBe(4);

  stop();
  jest.advanceTimersByTime(1_000);
  expect(adapter.sentMessages).toBe(4);
  jest.useRealTimers();
});

test("ignores a duplicate client start while the first connection is pending", async () => {
  setConnectionState("disconnected");
  let rejectFirst!: (reason?: unknown) => void;
  class PendingAdapter extends CountingAdapter {
    prepareCalls = 0;
    closeCalls = 0;

    async prepare(): Promise<void> {
      this.prepareCalls++;
      await new Promise<void>((_resolve, reject) => {
        rejectFirst = reject;
      });
    }

    close(): void {
      this.closeCalls++;
    }
  }

  const first = new PendingAdapter();
  const duplicate = new PendingAdapter();
  const runtimeScene = {
    getGame: () => ({ getSceneStack: () => ({}) }),
  } as unknown as gdjs.RuntimeScene;
  const firstStart = startClient(runtimeScene, first);
  await Promise.resolve();

  await startClient(runtimeScene, duplicate);
  expect(first.prepareCalls).toBe(1);
  expect(duplicate.prepareCalls).toBe(0);
  expect(duplicate.closeCalls).toBe(1);

  rejectFirst(new Error("test cleanup"));
  await firstStart;
  setConnectionState("disconnected");
});

test("explicitly stopping a pending client closes it and stops connection retries", async () => {
  jest.useFakeTimers();
  setConnectionState("disconnected");
  class CloseableAdapter extends CountingAdapter {
    closeCalls = 0;
    close(): void {
      this.closeCalls++;
    }
  }
  const adapter = new CloseableAdapter();
  const runtimeScene = {
    getGame: () => ({ getSceneStack: () => ({}) }),
  } as unknown as gdjs.RuntimeScene;

  await startClient(runtimeScene, adapter);
  expect(adapter.sentMessages).toBe(1);
  expect(stopClient(runtimeScene)).toBe(true);
  expect(adapter.closeCalls).toBe(1);

  jest.advanceTimersByTime(2_000);
  expect(adapter.sentMessages).toBe(1);
  jest.useRealTimers();
});
