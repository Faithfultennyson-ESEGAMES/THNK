/// <reference path="../types/global.d.ts"/>
namespace THNK {
  const logger = new gdjs.Logger("THNK - Local Testing Adapter");
  if (!globalThis.BroadcastChannel)
    logger.error(
      "This browser does not support the local adapter - please try using another adapter! (Prepare for an error)"
    );
  const bc = new BroadcastChannel("thnk-local-server");
  bc.addEventListener("messageerror", (e) =>
    logger.error("An error occured while sending a message!", e)
  );
  const ownID = "" + Date.now() + Math.random() * 1000;
  const inProcessListeners = new Set<(event: MessageEvent<MessageTypes>) => void>();
  const post = (data: MessageTypes) => {
    bc.postMessage(data);
    queueMicrotask(() => {
      const event = { data } as MessageEvent<MessageTypes>;
      for (const listener of inProcessListeners) listener(event);
    });
  };
  const subscribe = (listener: (event: MessageEvent<MessageTypes>) => void) => {
    bc.addEventListener("message", listener);
    inProcessListeners.add(listener);
  };
  const unsubscribe = (listener: (event: MessageEvent<MessageTypes>) => void) => {
    bc.removeEventListener("message", listener);
    inProcessListeners.delete(listener);
  };

  type MessageTypes =
    | {
        message: "msg-for-client";
        data: Uint8Array;
        for: string;
      }
    | { message: "msg-for-server"; data: Uint8Array; from: string }
    | { message: "disconnect"; from: string }
    | { message: "connect"; from: string };

  export class LocalClientAdapter extends THNK.ClientAdapter {
    private onBCMessage({ data }: MessageEvent<MessageTypes>) {
      if (data.message === "msg-for-client" && data.for === ownID)
        this.onMessage(data.data);
    }
    private boundOnBCMessage = this.onBCMessage.bind(this);

    async prepare(runtimeScene: gdjs.RuntimeScene): Promise<void> {
      subscribe(this.boundOnBCMessage);
      post({ message: "connect", from: ownID });
      window.addEventListener("beforeunload", () => this.close());
    }

    close() {
      post({ message: "disconnect", from: ownID });
      unsubscribe(this.boundOnBCMessage);
    }

    protected doSendMessage(message: Uint8Array): void {
      post({
        message: "msg-for-server",
        data: message,
        from: ownID,
      });
    }
  }

  export class LocalServerAdapter extends THNK.ServerAdapter {
    private onBCMessage({ data }: MessageEvent<MessageTypes>) {
      if (data.message === "msg-for-server")
        this.onMessage(data.from, data.data);
      else if (data.message === "connect") this.onConnection(data.from);
      else if (data.message === "disconnect") this.onDisconnection(data.from);
    }
    private boundOnBCMessage = this.onBCMessage.bind(this);

    async prepare(): Promise<void> {
      subscribe(this.boundOnBCMessage);
      window.addEventListener("beforeunload", () => this.close());
    }

    close() {
      unsubscribe(this.boundOnBCMessage);
    }

    protected doSendMessageTo(userID: string, message: Uint8Array): void {
      post({
        message: "msg-for-client",
        data: message,
        for: userID,
      });
    }

    getServerID(): string {
      return ownID;
    }
  }
}
