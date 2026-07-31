(globalThis as unknown as { gdjs: unknown }).gdjs = {
  Logger: class {
    warn() {}
  },
};
(globalThis as unknown as { THNK: unknown }).THNK = {};

jest.mock("agora-rtc-sdk-ng", () => ({
  __esModule: true,
  default: {
    createClient: jest.fn(),
    createMicrophoneAudioTrack: jest.fn(),
  },
}));

const { AgoraSessionVoice } =
  require("./AgoraSessionVoice") as typeof import("./AgoraSessionVoice");

class FakeClient {
  handlers = new Map<string, ((...arguments_: any[]) => unknown)[]>();
  connectionState = "CONNECTED";
  join = jest.fn(async () => "alice-uid");
  leave = jest.fn(async () => {});
  publish = jest.fn(async () => {});
  subscribe = jest.fn(async () => {});
  renewToken = jest.fn(async () => {});
  enableAudioVolumeIndicator = jest.fn();

  on(name: string, callback: (...arguments_: any[]) => unknown) {
    const handlers = this.handlers.get(name) || [];
    handlers.push(callback);
    this.handlers.set(name, handlers);
  }

  async emit(name: string, ...arguments_: any[]) {
    await Promise.all(
      (this.handlers.get(name) || []).map((handler) => handler(...arguments_))
    );
  }
}

const grant = (overrides = {}) => ({
  appId: "a".repeat(32),
  channel: "thnk-session-channel",
  uid: "alice-uid",
  token: "007-initial-token",
  expiresAt: new Date(Date.now() + 600_000).toISOString(),
  participants: [
    { playerId: "alice", uid: "alice-uid" },
    { playerId: "bob", uid: "bob-uid" },
  ],
  refreshUrl: "https://voice.example/v1/voice/token",
  refreshCapability: "v".repeat(43),
  ...overrides,
});

const voices: InstanceType<typeof AgoraSessionVoice>[] = [];
const makeVoice = ({ microphoneError, fetchImpl }: any = {}) => {
  const client = new FakeClient();
  const localTrack = {
    setMuted: jest.fn(async () => {}),
    close: jest.fn(),
  };
  const sdk = {
    createClient: jest.fn(() => client),
    createMicrophoneAudioTrack: microphoneError
      ? jest.fn(async () => {
          throw microphoneError;
        })
      : jest.fn(async () => localTrack),
  };
  const voice = new AgoraSessionVoice(sdk as any, fetchImpl || jest.fn());
  voices.push(voice);
  return { voice, client, localTrack, sdk };
};

afterEach(async () => {
  for (const voice of voices.splice(0)) await voice.handleGameplayDisconnect();
  jest.restoreAllMocks();
});

test("auto-joins only after an admission grant and publishes microphone audio", async () => {
  const { voice, client, localTrack, sdk } = makeVoice();
  expect(voice.getConnectionState()).toBe("WAITING_FOR_ADMISSION");

  await voice.handleAdmission(grant());

  expect(sdk.createClient).toHaveBeenCalledWith({ mode: "rtc", codec: "vp8" });
  expect(client.join).toHaveBeenCalledWith(
    "a".repeat(32),
    "thnk-session-channel",
    "007-initial-token",
    "alice-uid"
  );
  expect(client.publish).toHaveBeenCalledWith(localTrack);
  expect(voice.getConnectionState()).toBe("CONNECTED");
  expect(voice.isConnected()).toBe(true);
});

test("microphone denial leaves voice listen-only and never throws into gameplay", async () => {
  const denial = new Error("browser detail must not surface");
  denial.name = "NotAllowedError";
  const { voice, client } = makeVoice({ microphoneError: denial });

  await expect(voice.handleAdmission(grant())).resolves.toBeUndefined();

  expect(client.join).toHaveBeenCalled();
  expect(client.publish).not.toHaveBeenCalled();
  expect(voice.getConnectionState()).toBe("CONNECTED_LISTEN_ONLY");
  expect(voice.getLastError()).toBe("microphone_permission_denied");
  expect(voice.isConnected()).toBe(true);
});

test("maps canonical player IDs to remote audio mute, volume, and speaking state", async () => {
  const { voice, client } = makeVoice();
  await voice.handleAdmission(grant());
  const remoteTrack = { play: jest.fn(), setVolume: jest.fn() };
  const bob = { uid: "bob-uid", audioTrack: remoteTrack };

  await client.emit("user-published", bob, "audio");
  voice.setRemoteVolume("bob", 37);
  voice.setRemoteMuted("bob", true);
  expect(remoteTrack.play).toHaveBeenCalled();
  expect(remoteTrack.setVolume).toHaveBeenLastCalledWith(0);
  expect(voice.isRemoteMuted("bob")).toBe(true);

  voice.setRemoteMuted("bob", false);
  expect(remoteTrack.setVolume).toHaveBeenLastCalledWith(37);
  await client.emit("volume-indicator", [{ uid: "bob-uid", level: 42 }]);
  expect(voice.isSpeaking("bob")).toBe(true);
  expect(voice.getSpeakingLevel("bob")).toBe(42);
});

test("refreshes with the opaque capability and rejects identity changes in a response", async () => {
  const fetchImpl = jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          appId: "a".repeat(32),
          channel: "thnk-session-channel",
          uid: "alice-uid",
          token: "007-refreshed-token",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
  );
  const { voice, client } = makeVoice({ fetchImpl });
  await voice.handleAdmission(grant());

  await (voice as any).refreshToken(false);

  expect(fetchImpl).toHaveBeenCalledWith(
    "https://voice.example/v1/voice/token",
    expect.objectContaining({
      method: "POST",
      headers: { authorization: `Bearer ${"v".repeat(43)}` },
      credentials: "omit",
      referrerPolicy: "no-referrer",
    })
  );
  expect(client.renewToken).toHaveBeenCalledWith("007-refreshed-token");
  expect(voice.getLastError()).toBe("");
});

test("a refresh returning a new channel migrates the connection to it", async () => {
  const fetchImpl = jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          appId: "a".repeat(32),
          channel: "squad-red",
          uid: "alice-uid",
          token: "007-squad-red-token",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
  );
  const { voice, client } = makeVoice({ fetchImpl });
  await voice.handleAdmission(grant());
  expect(client.join).toHaveBeenLastCalledWith(
    "a".repeat(32),
    "thnk-session-channel",
    "007-initial-token",
    "alice-uid"
  );

  await (voice as any).refreshToken(false);

  expect(client.renewToken).not.toHaveBeenCalled();
  expect(client.leave).toHaveBeenCalled();
  expect(client.join).toHaveBeenLastCalledWith(
    "a".repeat(32),
    "squad-red",
    "007-squad-red-token",
    "alice-uid"
  );
  expect(voice.getLastError()).toBe("");

  const changedIdentity = jest.fn(
    async () =>
      new Response(
        JSON.stringify({
          appId: "a".repeat(32),
          channel: "squad-red",
          uid: "mallory-uid",
          token: "007-stolen-token",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
  );
  const stolen = makeVoice({ fetchImpl: changedIdentity });
  await stolen.voice.handleAdmission(grant());
  await (stolen.voice as any).refreshToken(false);
  expect(stolen.voice.getLastError()).toBe("invalid_voice_refresh");
});

test("Agora/token endpoint outage remains a voice-only error", async () => {
  const fetchImpl = jest.fn(async () => {
    throw Object.assign(new Error("network details"), {
      code: "NETWORK_ERROR",
    });
  });
  const { voice } = makeVoice({ fetchImpl });
  await voice.handleAdmission(grant());

  await expect((voice as any).refreshToken(false)).resolves.toBeUndefined();

  expect(voice.getConnectionState()).toBe("CONNECTED");
  expect(voice.getLastError()).toBe("network_error");
  expect(voice.isConnected()).toBe(true);
});

test("gameplay disconnect leaves Agora and clears the previous admission", async () => {
  const { voice, client, localTrack } = makeVoice();
  await voice.handleAdmission(grant());

  await voice.handleGameplayDisconnect();

  expect(localTrack.close).toHaveBeenCalled();
  expect(client.leave).toHaveBeenCalled();
  expect(voice.getConnectionState()).toBe("DISCONNECTED");
  await voice.join();
  expect(voice.getConnectionState()).toBe("WAITING_FOR_ADMISSION");
  expect(voice.getLastError()).toBe("voice_admission_required");
});

test("leaving gameplay during an in-flight Agora join is an intentional cancellation", async () => {
  const { voice, client } = makeVoice();
  let rejectJoin!: (error: Error) => void;
  client.join.mockImplementation(
    () =>
      new Promise<string>((_resolve, reject) => {
        rejectJoin = reject;
      })
  );

  const admission = voice.handleAdmission(grant());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(client.join).toHaveBeenCalled();

  await voice.handleGameplayDisconnect();
  rejectJoin(Object.assign(new Error("LEAVE"), { code: "WS_ABORT" }));
  await admission;

  expect(voice.getConnectionState()).toBe("DISCONNECTED");
  expect(voice.getLastError()).toBe("");
});

test("leaving gameplay never aborts an Agora handshake that is still in flight", async () => {
  const { voice, client } = makeVoice();
  let resolveJoin!: (uid: string) => void;
  client.join.mockImplementation(
    () =>
      new Promise<string>((resolve) => {
        resolveJoin = resolve;
      })
  );

  const admission = voice.handleAdmission(grant());
  while (!client.join.mock.calls.length)
    await new Promise((resolve) => setTimeout(resolve, 0));

  await voice.handleGameplayDisconnect();
  // Closing the client here is what makes Agora log WS_ABORT: LEAVE and
  // roll the join back; gameplay must still not wait for the handshake.
  expect(client.leave).not.toHaveBeenCalled();
  expect(voice.getConnectionState()).toBe("DISCONNECTED");

  resolveJoin("alice-uid");
  await admission;

  expect(client.leave).toHaveBeenCalled();
  expect(client.publish).not.toHaveBeenCalled();
  expect(voice.getConnectionState()).toBe("DISCONNECTED");
  expect(voice.getLastError()).toBe("");
});

test("a peer connection that starts closing during microphone setup is never published to", async () => {
  const { voice, client, localTrack } = makeVoice();
  let finishMuted!: () => void;
  localTrack.setMuted.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishMuted = resolve;
      })
  );

  const admission = voice.handleAdmission(grant());
  while (!localTrack.setMuted.mock.calls.length)
    await new Promise((resolve) => setTimeout(resolve, 0));

  client.connectionState = "DISCONNECTING";
  finishMuted();
  await admission;

  expect(client.publish).not.toHaveBeenCalled();
  expect(localTrack.close).toHaveBeenCalled();
  expect(voice.getLastError()).toBe("");
});

test("muting a track closed by an intentional teardown reports no voice error", async () => {
  const { voice, localTrack } = makeVoice();
  await voice.handleAdmission(grant());
  let rejectMuted!: (error: Error) => void;
  localTrack.setMuted.mockImplementation(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectMuted = reject;
      })
  );

  const muting = voice.setSelfMuted(true);
  await voice.handleGameplayDisconnect();
  rejectMuted(new Error("TRACK_IS_DISABLED"));
  await muting;

  expect(voice.getLastError()).toBe("");
  expect(voice.isSelfMuted()).toBe(true);
});

test("a superseded admission cannot evict roster state from the current session", async () => {
  const { voice, client } = makeVoice();
  await voice.handleAdmission(grant());
  const remoteTrack = { play: jest.fn(), setVolume: jest.fn() };
  await client.emit("user-published", { uid: "bob-uid", audioTrack: remoteTrack }, "audio");
  await client.emit("volume-indicator", [{ uid: "bob-uid", level: 42 }]);
  expect(voice.isSpeaking("bob")).toBe(true);

  ++(voice as any).generation;
  await client.emit("user-left", { uid: "bob-uid" });

  expect(voice.isSpeaking("bob")).toBe(true);
});

test("leaving while microphone setup is pending never publishes on a closed connection", async () => {
  const { voice, client, localTrack } = makeVoice();
  let finishMuted!: () => void;
  localTrack.setMuted.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishMuted = resolve;
      })
  );

  const admission = voice.handleAdmission(grant());
  while (!localTrack.setMuted.mock.calls.length)
    await new Promise((resolve) => setTimeout(resolve, 0));

  await voice.handleGameplayDisconnect();
  finishMuted();
  await admission;

  expect(client.publish).not.toHaveBeenCalled();
  expect(voice.getConnectionState()).toBe("DISCONNECTED");
  expect(voice.getLastError()).toBe("");
});

test("a remote player publishing as the connection closes is not subscribed to", async () => {
  const { voice, client } = makeVoice();
  await voice.handleAdmission(grant());
  const remoteTrack = { play: jest.fn(), setVolume: jest.fn() };

  client.connectionState = "DISCONNECTING";
  await client.emit("user-published", { uid: "bob-uid", audioTrack: remoteTrack }, "audio");

  expect(client.subscribe).not.toHaveBeenCalled();
  expect(remoteTrack.play).not.toHaveBeenCalled();
  expect(voice.getLastError()).toBe("");
});
