import type { ClientAdapter } from "adapters/Adapter";
import {
  Builder,
  ClientMessage,
  ClientMessageContent,
  ClientPingMessage,
} from "t-h-n-k";

let lastProbeAt = -Infinity;
let pendingSentAt: number | undefined;
let latencyMs = 0;
let updateGeneration = 0;
const observations = new WeakMap<
  gdjs.RuntimeScene,
  { generation: number; frame: number }
>();

export const maybeSendAuthorityLatencyProbe = (
  adapter: ClientAdapter,
  now = Date.now(),
  intervalMs = 1_000
) => {
  if (now - lastProbeAt < intervalMs) return false;
  lastProbeAt = now;
  pendingSentAt = now;
  const builder = new Builder(64);
  ClientPingMessage.startClientPingMessage(builder);
  ClientPingMessage.addSentAt(builder, now);
  adapter.sendClientMessage(
    builder,
    ClientMessage.createClientMessage(
      builder,
      ClientMessageContent.ClientPingMessage,
      ClientPingMessage.endClientPingMessage(builder)
    )
  );
  return true;
};

export const acceptAuthorityLatencyPong = (
  sentAt: number,
  now = Date.now()
) => {
  if (pendingSentAt !== sentAt || sentAt > now) return false;
  const sample = Math.max(0, now - sentAt);
  latencyMs = updateGeneration === 0 ? sample : latencyMs * 0.75 + sample * 0.25;
  pendingSentAt = undefined;
  updateGeneration += 1;
  return true;
};

export const getAuthorityLatencyMs = () => latencyMs;

export const authorityLatencyUpdated = (runtimeScene: gdjs.RuntimeScene) => {
  const frame = runtimeScene.getTimeManager().getTimeFromStart();
  const observed = observations.get(runtimeScene);
  if (!observed || observed.generation < updateGeneration) {
    observations.set(runtimeScene, {
      generation: updateGeneration,
      frame,
    });
    return updateGeneration > 0;
  }
  return observed.frame === frame && updateGeneration > 0;
};

export const resetAuthorityLatency = () => {
  lastProbeAt = -Infinity;
  pendingSentAt = undefined;
  latencyMs = 0;
  updateGeneration = 0;
};
