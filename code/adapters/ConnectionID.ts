const defaultRandomUUID = () => {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();

  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues(bytes);
  if (!bytes.some((byte) => byte !== 0))
    throw new Error("A cryptographically secure random source is required.");

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
};

export class ConnectionIDFactory {
  private nextSequence = 0;
  private readonly sessionID: string;

  constructor(randomUUID: () => string = defaultRandomUUID) {
    this.sessionID = randomUUID();
  }

  getServerID() {
    return `${this.sessionID}:server`;
  }

  createClientID() {
    return `${this.sessionID}:client:${this.nextSequence++}`;
  }
}
