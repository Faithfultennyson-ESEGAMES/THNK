import { setConnectionState } from "client/ClientConnectionState";
import {
  ClientMessage,
  ServerMessage,
  ByteBuffer,
  type Builder,
} from "t-h-n-k";
import { inflateRaw, deflateRaw } from "pako";

const decompress = (data: Uint8Array): Uint8Array =>
  inflateRaw(data) as Uint8Array;
const compress = (data: Uint8Array): Uint8Array =>
  deflateRaw(data, { level: 9 });

export abstract class ClientAdapter {
  /** Ensure returns a promise that resolves once fully connected to a server. */
  abstract prepare(runtimeScene: gdjs.RuntimeScene): Promise<void>;
  /** Called when the adapter is no longer needed to gracefully shutdown. */
  abstract close(): void;

  sendClientMessage(builder: Builder, messageOffset: number): void {
    builder.finish(messageOffset);
    this.doSendMessage(compress(builder.asUint8Array()));
  }

  private readonly pendingMessages: ServerMessage[] = [];
  getPendingMessages(): readonly ServerMessage[] {
    return this.pendingMessages;
  }
  markPendingMessagesAsRead(): void {
    this.pendingMessages.length = 0;
  }

  /** Override to send an Uint8Array to the server/client. */
  protected abstract doSendMessage(message: Uint8Array): void;
  /** Call this whenever the server/client has sent a message. */
  protected onMessage(bytes: Uint8Array): void {
    this.pendingMessages.push(
      ServerMessage.getRootAsServerMessage(new ByteBuffer(decompress(bytes)))
    );
  }
  protected onDisconnection(): void {
    setConnectionState("disconnected");
  }
}

export abstract class ServerAdapter {
  /** Ensure returns a promise that resolves once fully connected to a server. */
  abstract prepare(runtimeScene: gdjs.RuntimeScene): Promise<void>;
  /** Called when the adapter is no longer needed to gracefully shutdown. */
  abstract close(): void;

  sendServerMessageTo(
    userID: string,
    builder: Builder,
    messageOffset: number
  ): void {
    builder.finish(messageOffset);
    this.doSendMessageTo(userID, compress(builder.asUint8Array()));
  }
  sendServerMessageToAll(builder: Builder, messageOffset: number) {
    builder.finish(messageOffset);
    const messageAsArray = compress(builder.asUint8Array());
    for (const userID of this.usersPendingMessages.keys())
      this.doSendMessageTo(userID, messageAsArray);
  }

  private readonly usersPendingMessages = new Map<string, ClientMessage[]>();
  getUsersPendingMessages(): IterableIterator<[string, ClientMessage[]]> {
    return this.usersPendingMessages.entries();
  }
  getConnectedUsers(): IterableIterator<string> {
    return this.usersPendingMessages.keys();
  }

  private readonly disconnectedUsers: string[] = [];
  getDisconnectedUsers(): string[] {
    return this.disconnectedUsers;
  }

  /** Override to return the playerID of the server. */
  abstract getServerID(): string;
  /** Override to send an Uint8Array to all the clients. */
  protected abstract doSendMessageTo(userID: string, message: Uint8Array): void;
  /** Call this whenever the server/client has sent a message. */
  protected onMessage(userID: string, bytes: Uint8Array): boolean {
    const pendingMessages = this.usersPendingMessages.get(userID);
    // A transport can deliver a final packet after its disconnect callback.
    // Ignore it instead of crashing the server tick with a missing queue.
    if (!pendingMessages) return false;

    pendingMessages.push(
      ClientMessage.getRootAsClientMessage(new ByteBuffer(decompress(bytes)))
    );
    return true;
  }
  /** Call this whenever a client connects. */
  protected onConnection(userID: string): boolean {
    // Duplicate transport callbacks must not discard already queued input.
    if (this.usersPendingMessages.has(userID)) return false;
    this.usersPendingMessages.set(userID, []);
    return true;
  }
  /** Call this whenever a client disconnects. */
  protected onDisconnection(userID: string): boolean {
    // Only report a real connected -> disconnected transition once.
    if (!this.usersPendingMessages.delete(userID)) return false;
    this.disconnectedUsers.push(userID);
    return true;
  }
}
