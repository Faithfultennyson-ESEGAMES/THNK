import { ClientAdapter } from "adapters/Adapter";
import { startConnectionRequestRetry } from "client/ConnectionRequestRetry";

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
