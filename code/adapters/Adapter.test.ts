import { ClientAdapter, ServerAdapter } from "adapters/Adapter";
import { sendConnectionRequest } from "client/ClientMessageSender";
import { ClientMessageContent } from "t-h-n-k";

class CapturingClientAdapter extends ClientAdapter {
  lastMessage?: Uint8Array;

  async prepare(): Promise<void> {}
  close(): void {}

  protected doSendMessage(message: Uint8Array): void {
    this.lastMessage = message;
  }
}

class TestServerAdapter extends ServerAdapter {
  async prepare(): Promise<void> {}
  close(): void {}
  getServerID(): string {
    return "server";
  }

  connect(userID: string): boolean {
    return this.onConnection(userID);
  }
  disconnect(userID: string): boolean {
    return this.onDisconnection(userID);
  }
  receive(userID: string, message: Uint8Array): boolean {
    return this.onMessage(userID, message);
  }

  protected doSendMessageTo(): void {}
}

const connectionRequest = (): Uint8Array => {
  const client = new CapturingClientAdapter();
  sendConnectionRequest(client);
  return client.lastMessage!;
};

describe("ServerAdapter connection lifecycle", () => {
  test("keeps queued input when a duplicate connect callback arrives", () => {
    const adapter = new TestServerAdapter();
    const message = connectionRequest();

    expect(adapter.connect("player-1")).toBe(true);
    expect(adapter.receive("player-1", message)).toBe(true);
    expect(adapter.connect("player-1")).toBe(false);

    const [, queuedMessages] = [...adapter.getUsersPendingMessages()][0];
    expect(queuedMessages).toHaveLength(1);
    expect(queuedMessages[0].contentType()).toBe(
      ClientMessageContent.ConnectionRequestMessage
    );
  });

  test("reports a disconnect once and ignores late packets", () => {
    const adapter = new TestServerAdapter();
    const message = connectionRequest();

    adapter.connect("player-1");
    expect(adapter.disconnect("player-1")).toBe(true);
    expect(adapter.disconnect("player-1")).toBe(false);
    expect(adapter.getDisconnectedUsers()).toEqual(["player-1"]);
    expect(adapter.receive("player-1", message)).toBe(false);
  });
});
