import { ClientAdapter } from "adapters/Adapter";
import {
  acceptAuthorityLatencyPong,
  authorityLatencyUpdated,
  getAuthorityLatencyMs,
  maybeSendAuthorityLatencyProbe,
  resetAuthorityLatency,
} from "client/AuthorityLatency";

class ProbeAdapter extends ClientAdapter {
  sent = 0;
  prepare = async () => {};
  close = () => {};
  protected doSendMessage() {
    this.sent += 1;
  }
}

beforeEach(resetAuthorityLatency);

test("authority latency probes are rate limited and smoothed", () => {
  const adapter = new ProbeAdapter();
  expect(maybeSendAuthorityLatencyProbe(adapter, 1_000)).toBe(true);
  expect(maybeSendAuthorityLatencyProbe(adapter, 1_500)).toBe(false);
  expect(adapter.sent).toBe(1);
  expect(acceptAuthorityLatencyPong(1_000, 1_120)).toBe(true);
  expect(getAuthorityLatencyMs()).toBe(120);

  expect(maybeSendAuthorityLatencyProbe(adapter, 2_000)).toBe(true);
  expect(acceptAuthorityLatencyPong(2_000, 2_080)).toBe(true);
  expect(getAuthorityLatencyMs()).toBe(110);
});

test("latency update condition stays true for one event frame", () => {
  const adapter = new ProbeAdapter();
  maybeSendAuthorityLatencyProbe(adapter, 1_000);
  acceptAuthorityLatencyPong(1_000, 1_050);
  let frame = 100;
  const scene = {
    getTimeManager: () => ({ getTimeFromStart: () => frame }),
  } as gdjs.RuntimeScene;
  expect(authorityLatencyUpdated(scene)).toBe(true);
  expect(authorityLatencyUpdated(scene)).toBe(true);
  frame = 116;
  expect(authorityLatencyUpdated(scene)).toBe(false);
});
