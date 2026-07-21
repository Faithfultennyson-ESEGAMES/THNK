import AgoraRTC, {
  type IAgoraRTCClient,
  type IAgoraRTCRemoteUser,
  type ILocalAudioTrack,
  type UID,
} from "agora-rtc-sdk-ng";

export type VoiceConnectionState =
  | "DISABLED"
  | "WAITING_FOR_ADMISSION"
  | "JOINING"
  | "CONNECTED"
  | "CONNECTED_LISTEN_ONLY"
  | "RECONNECTING"
  | "DISCONNECTED"
  | "FAILED";

export interface VoiceParticipant {
  playerId: string;
  uid: string;
}

export interface VoiceGrant {
  available?: boolean;
  errorCode?: string;
  appId?: string;
  channel?: string;
  uid?: string;
  token?: string;
  expiresAt?: string;
  participants?: VoiceParticipant[];
  refreshUrl?: string;
  refreshCapability?: string;
}

interface CompleteVoiceGrant extends VoiceGrant {
  appId: string;
  channel: string;
  uid: string;
  token: string;
  expiresAt: string;
  participants: VoiceParticipant[];
  refreshUrl: string;
  refreshCapability: string;
}

type AgoraSdk = Pick<
  typeof AgoraRTC,
  "createClient" | "createMicrophoneAudioTrack"
>;

const logger = new gdjs.Logger("THNK - Agora session voice");
const SPEAKING_THRESHOLD = 5;

const isCompleteGrant = (grant: VoiceGrant): grant is CompleteVoiceGrant =>
  typeof grant.appId === "string" &&
  typeof grant.channel === "string" &&
  typeof grant.uid === "string" &&
  typeof grant.token === "string" &&
  typeof grant.expiresAt === "string" &&
  Array.isArray(grant.participants) &&
  typeof grant.refreshUrl === "string" &&
  typeof grant.refreshCapability === "string";

const errorCode = (error: unknown, fallback = "voice_operation_failed") => {
  const candidate = error as { code?: unknown; name?: unknown };
  if (candidate?.name === "NotAllowedError")
    return "microphone_permission_denied";
  const code =
    typeof candidate?.code === "string"
      ? candidate.code
      : typeof candidate?.name === "string"
      ? candidate.name
      : fallback;
  return code
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 80);
};

export class AgoraSessionVoice {
  private sdk: AgoraSdk;
  private fetchImpl: typeof fetch;
  private client: IAgoraRTCClient | undefined;
  private localTrack: ILocalAudioTrack | undefined;
  private grant: CompleteVoiceGrant | undefined;
  private joinPromise: Promise<void> | undefined;
  private refreshPromise: Promise<void> | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private autoJoin = true;
  private mutedSelf = false;
  private state: VoiceConnectionState = "WAITING_FOR_ADMISSION";
  private lastError = "";
  private playerByUid = new Map<string, string>();
  private uidByPlayer = new Map<string, string>();
  private remoteUsers = new Map<string, IAgoraRTCRemoteUser>();
  private remoteMuted = new Set<string>();
  private remoteVolumes = new Map<string, number>();
  private volumeLevels = new Map<string, number>();

  constructor(
    sdk: AgoraSdk = AgoraRTC,
    fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)
  ) {
    this.sdk = sdk;
    this.fetchImpl = fetchImpl;
  }

  private setError(code: string, state?: VoiceConnectionState) {
    this.lastError = code;
    if (state) this.state = state;
    logger.warn(`Voice status: ${code}`);
  }

  private configureParticipants(participants: VoiceParticipant[]) {
    this.playerByUid.clear();
    this.uidByPlayer.clear();
    for (const participant of participants) {
      this.playerByUid.set(String(participant.uid), participant.playerId);
      this.uidByPlayer.set(participant.playerId, String(participant.uid));
    }
  }

  async handleAdmission(grant: VoiceGrant | undefined): Promise<void> {
    const generation = ++this.generation;
    await this.leaveInternal(false);
    if (generation !== this.generation) return;
    if (!grant) {
      this.grant = undefined;
      this.state = "DISABLED";
      return;
    }
    if (grant.available === false) {
      this.grant = undefined;
      this.setError(grant.errorCode || "voice_unavailable", "FAILED");
      return;
    }
    if (!isCompleteGrant(grant)) {
      this.grant = undefined;
      this.setError("invalid_voice_grant", "FAILED");
      return;
    }
    this.grant = { ...grant, participants: [...grant.participants] };
    this.configureParticipants(grant.participants);
    this.state = "WAITING_FOR_ADMISSION";
    this.lastError = "";
    if (this.autoJoin) await this.join();
  }

  async handleGameplayDisconnect(): Promise<void> {
    ++this.generation;
    await this.leaveInternal(false);
    this.grant = undefined;
    this.playerByUid.clear();
    this.uidByPlayer.clear();
    this.state = "DISCONNECTED";
  }

  async join(): Promise<void> {
    this.autoJoin = true;
    if (!this.grant) {
      this.setError("voice_admission_required", "WAITING_FOR_ADMISSION");
      return;
    }
    if (this.state === "CONNECTED" || this.state === "CONNECTED_LISTEN_ONLY")
      return;
    if (this.joinPromise) return this.joinPromise;
    const generation = this.generation;
    this.joinPromise = this.joinInternal(generation).finally(() => {
      this.joinPromise = undefined;
    });
    return this.joinPromise;
  }

  private async joinInternal(generation: number): Promise<void> {
    const grant = this.grant;
    if (!grant) return;
    this.state = "JOINING";
    this.lastError = "";
    try {
      const client = this.sdk.createClient({ mode: "rtc", codec: "vp8" });
      this.client = client;
      this.registerClientEvents(client, generation);
      await client.join(grant.appId, grant.channel, grant.token, grant.uid);
      if (generation !== this.generation) {
        await client.leave();
        return;
      }
      client.enableAudioVolumeIndicator();
      this.state = "CONNECTED_LISTEN_ONLY";
      this.scheduleRefresh();
      try {
        const track = await this.sdk.createMicrophoneAudioTrack();
        if (generation !== this.generation) {
          track.close();
          return;
        }
        this.localTrack = track;
        await track.setMuted(this.mutedSelf);
        await client.publish(track);
        this.state = "CONNECTED";
      } catch (error) {
        this.setError(errorCode(error, "microphone_unavailable"));
        this.state = "CONNECTED_LISTEN_ONLY";
      }
    } catch (error) {
      this.setError(errorCode(error, "voice_join_failed"), "FAILED");
      await this.leaveInternal(false);
      if (this.grant) this.state = "FAILED";
    }
  }

  private registerClientEvents(client: IAgoraRTCClient, generation: number) {
    client.on("user-published", async (user, mediaType) => {
      if (generation !== this.generation || mediaType !== "audio") return;
      try {
        await client.subscribe(user, "audio");
        this.remoteUsers.set(String(user.uid), user);
        user.audioTrack?.play();
        this.applyRemoteSettings(String(user.uid));
      } catch (error) {
        this.setError(errorCode(error, "voice_subscribe_failed"));
      }
    });
    client.on("user-unpublished", (user, mediaType) => {
      if (mediaType === "audio") this.remoteUsers.delete(String(user.uid));
    });
    client.on("user-left", (user) => {
      const uid = String(user.uid);
      this.remoteUsers.delete(uid);
      this.volumeLevels.delete(uid);
    });
    client.on("volume-indicator", (volumes) => {
      for (const volume of volumes)
        this.volumeLevels.set(String(volume.uid), volume.level);
    });
    client.on("connection-state-change", (current) => {
      if (generation !== this.generation) return;
      if (current === "RECONNECTING") this.state = "RECONNECTING";
      else if (current === "CONNECTED")
        this.state = this.localTrack ? "CONNECTED" : "CONNECTED_LISTEN_ONLY";
      else if (current === "DISCONNECTED" && this.client)
        this.state = "DISCONNECTED";
    });
    client.on("token-privilege-will-expire", () => {
      void this.refreshToken(false);
    });
    client.on("token-privilege-did-expire", () => {
      void this.refreshToken(true);
    });
  }

  private scheduleRefresh(delayMs?: number) {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (!this.grant) return;
    const expiresAt = Date.parse(this.grant.expiresAt);
    const delay = delayMs ?? Math.max(1_000, expiresAt - Date.now() - 45_000);
    this.refreshTimer = setTimeout(() => void this.refreshToken(false), delay);
  }

  private async refreshToken(expired: boolean): Promise<void> {
    if (!this.grant || !this.client) return;
    if (this.refreshPromise) return this.refreshPromise;
    const grant = this.grant;
    const generation = this.generation;
    this.refreshPromise = (async () => {
      try {
        const response = await this.fetchImpl(grant.refreshUrl, {
          method: "POST",
          headers: { authorization: `Bearer ${grant.refreshCapability}` },
          cache: "no-store",
          credentials: "omit",
          referrerPolicy: "no-referrer",
        });
        const body = (await response.json()) as VoiceGrant;
        if (!response.ok)
          throw Object.assign(new Error("voice_refresh_failed"), {
            code: body.errorCode || (body as { error?: string }).error,
            retryAfter: response.headers.get("retry-after"),
          });
        if (
          body.appId !== grant.appId ||
          body.uid !== grant.uid ||
          typeof body.channel !== "string" ||
          body.channel.length < 1 ||
          typeof body.token !== "string" ||
          typeof body.expiresAt !== "string"
        )
          throw Object.assign(new Error("invalid_voice_refresh"), {
            code: "invalid_voice_refresh",
          });
        if (generation !== this.generation || !this.client) return;
        // The matchmaker may reassign this player to a different channel
        // mid-session (Set Voice Channel); a refresh returning a new channel
        // migrates the connection instead of only renewing the token.
        const channelChanged = body.channel !== grant.channel;
        grant.channel = body.channel;
        grant.token = body.token;
        grant.expiresAt = body.expiresAt;
        if (expired || channelChanged) {
          await this.leaveInternal(false);
          this.state = "DISCONNECTED";
          if (generation === this.generation) await this.join();
        } else await this.client.renewToken(body.token);
        this.lastError = "";
        this.scheduleRefresh();
      } catch (error) {
        this.setError(errorCode(error, "voice_refresh_failed"));
        const retryAfter = Number(
          (error as { retryAfter?: unknown })?.retryAfter
        );
        this.scheduleRefresh(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1_000
            : 5_000
        );
      }
    })().finally(() => {
      this.refreshPromise = undefined;
    });
    return this.refreshPromise;
  }

  async leave(): Promise<void> {
    this.autoJoin = false;
    ++this.generation;
    await this.leaveInternal(true);
  }

  private async leaveInternal(manual: boolean): Promise<void> {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    const track = this.localTrack;
    const client = this.client;
    this.localTrack = undefined;
    this.client = undefined;
    this.remoteUsers.clear();
    this.volumeLevels.clear();
    try {
      track?.close();
      await client?.leave();
    } catch (error) {
      this.setError(errorCode(error, "voice_leave_failed"));
    }
    this.state = manual ? "DISCONNECTED" : this.state;
  }

  async setSelfMuted(muted: boolean): Promise<void> {
    this.mutedSelf = muted;
    try {
      await this.localTrack?.setMuted(muted);
    } catch (error) {
      this.setError(errorCode(error, "voice_mute_failed"));
    }
  }

  setRemoteMuted(playerId: string, muted: boolean) {
    const uid = this.uidByPlayer.get(playerId) || playerId;
    if (muted) this.remoteMuted.add(uid);
    else this.remoteMuted.delete(uid);
    this.applyRemoteSettings(uid);
  }

  setRemoteVolume(playerId: string, volume: number) {
    const uid = this.uidByPlayer.get(playerId) || playerId;
    this.remoteVolumes.set(uid, Math.max(0, Math.min(100, volume)));
    this.applyRemoteSettings(uid);
  }

  private applyRemoteSettings(uid: string) {
    const track = this.remoteUsers.get(uid)?.audioTrack;
    if (!track) return;
    track.setVolume(
      this.remoteMuted.has(uid) ? 0 : this.remoteVolumes.get(uid) ?? 100
    );
  }

  getConnectionState() {
    return this.state;
  }

  getLastError() {
    return this.lastError;
  }

  isConnected() {
    return this.state === "CONNECTED" || this.state === "CONNECTED_LISTEN_ONLY";
  }

  isSelfMuted() {
    return this.mutedSelf;
  }

  isRemoteMuted(playerId: string) {
    const uid = this.uidByPlayer.get(playerId) || playerId;
    return this.remoteMuted.has(uid);
  }

  isSpeaking(playerId: string) {
    const uid = this.uidByPlayer.get(playerId) || playerId;
    return (this.volumeLevels.get(uid) || 0) > SPEAKING_THRESHOLD;
  }

  getSpeakingLevel(playerId: string) {
    const uid = this.uidByPlayer.get(playerId) || playerId;
    return this.volumeLevels.get(uid) || 0;
  }
}

export const sessionVoice = new AgoraSessionVoice();

declare global {
  namespace THNK {
    let voice: AgoraSessionVoice;
  }
}

THNK.voice = sessionVoice;
