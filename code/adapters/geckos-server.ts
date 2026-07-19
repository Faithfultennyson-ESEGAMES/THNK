/// <reference path="../types/global.d.ts"/>
import type {
  geckos as GeckosType,
  GeckosServer,
  ServerChannel,
} from "@geckos.io/server";
import type { FollowResponse } from "follow-redirects";
import { ConnectionIDFactory } from "adapters/ConnectionID";

const logger = new gdjs.Logger("THNK - Geckos adapter");

THNK.GeckosServerAdapter = class GeckosServerAdapter extends (
  THNK.ServerAdapter
) {
  port: number;
  connectionIDs = new ConnectionIDFactory();
  server: GeckosServer | null = null;
  httpServer: import("http").Server | null = null;
  channels = new Map<string, ServerChannel>();
  bridge:
    | {
        playerConnected: (identity: unknown, connectionId: string) => boolean;
        playerDisconnected: (identity: unknown, connectionId: string) => void;
        onSessionEnding: (callback: () => void) => () => void;
      }
    | undefined;
  removeSessionEndingListener: (() => void) | undefined;
  beforeUnloadHandler: ((event: BeforeUnloadEvent) => void) | null = null;
  constructor(port: number) {
    super();
    this.port = port;
  }

  async prepare(runtimeScene: gdjs.RuntimeScene): Promise<void> {
    const electronRemote = runtimeScene
      .getGame()
      .getRenderer()
      .getElectronRemote();

    if (!electronRemote) {
      throw new Error(
        "The game does not seem to be running on a desktop, impossible to launch geckos server!"
      );
    }

    const electronRequire = electronRemote.require as <T>(
      moduleNameOrPath: string
    ) => T;

    let geckos: typeof GeckosType | undefined;
    if (!runtimeScene.getGame().isPreview()) {
      const { thnkGeckosBridgePath } = runtimeScene
        .getGame()
        .getAdditionalOptions() as { thnkGeckosBridgePath?: string };
      if (thnkGeckosBridgePath) {
        const bridge = electronRequire<{
          loadGeckos: () => Promise<void>;
          createServer: typeof GeckosType;
          playerConnected: (identity: unknown, connectionId: string) => boolean;
          playerDisconnected: (identity: unknown, connectionId: string) => void;
          onSessionEnding: (callback: () => void) => () => void;
        }>(thnkGeckosBridgePath);
        await bridge.loadGeckos();
        geckos = bridge.createServer;
        this.bridge = bridge;
        this.removeSessionEndingListener = bridge.onSessionEnding(() => {
          for (const channel of this.channels.values()) channel.close();
        });
      } else {
        geckos = electronRequire<{ geckos: typeof GeckosType }>(
          "@geckos.io/server"
        ).geckos;
      }
    } else {
      // On previews we need to download a prebuilt version of the module as it is not pre-installed
      const fs = electronRequire<typeof import("fs")>("fs");
      const path = electronRequire<typeof import("path")>("path");
      const { app } = electronRequire<{
        app: { getPath: (type: "userData" | "temp") => string };
      }>("electron");
      //@ts-ignore
      const { async: StreamZip } = await import("node-stream-zip");
      //@ts-ignore
      const { wrap } = await import("follow-redirects");

      const geckosFolderPath = path.join(
        app.getPath("userData"),
        "geckos-server"
      );
      const geckosIndexPath = path.join(geckosFolderPath, "index.js");
      if (!fs.existsSync(geckosIndexPath)) {
        const https = electronRequire("https") as typeof import("https");
        const {
          https: { get },
        } = wrap({ https });
        const { pipeline } = electronRequire(
          "stream/promises"
        ) as typeof import("stream/promises");

        console.info(`Geckos server not found, downloading it now!`);

        const geckosDownloadPath = path.join(
          app.getPath("temp"),
          "geckos-server.zip"
        );

        const response = (await new Promise((r) =>
          get(
            "https://s3.arthuro555.com/geckos-server-electron.zip",
            (response) => r(response as FollowResponse & NodeJS.ReadStream)
          )
        )) as NodeJS.ReadStream;

        await pipeline(response, fs.createWriteStream(geckosDownloadPath));

        const zip = new StreamZip({ file: geckosDownloadPath });

        fs.mkdirSync(geckosFolderPath, { recursive: true });
        await zip.extract(null, geckosFolderPath);

        await zip.close();
      }

      geckos = electronRequire<{ geckos: typeof GeckosType }>(
        geckosIndexPath
      ).geckos;
    }

    if (!geckos) throw new Error("Geckos not found!");

    this.server = geckos({
      label: "THNK",
      ordered: true,
      // Geckos turns an omitted value into 0 retransmissions. node-datachannel
      // treats null as the fully reliable mode, which THNK's ordered state
      // diffs require to keep delete/create messages from crossing each other.
      maxRetransmits: null as unknown as number,
    });

    this.server.onConnection((channel) => {
      const transportConnectionId =
        channel.id || this.connectionIDs.createClientID();
      const identity = (channel.userData as { thnkIdentity?: unknown })
        ?.thnkIdentity;
      // Generate a simple ID that is certainly unique,
      // yet not easily guessable (as that can open up
      // an attack vector in some cases)
      const id =
        (identity as { playerId?: string } | undefined)?.playerId ||
        this.connectionIDs.createClientID();
      THNK.players.setPlayerTags(
        id,
        (
          identity as
            | { tags?: Readonly<Record<string, string | number | boolean>> }
            | undefined
        )?.tags
      );

      if (!this.onConnection(id)) {
        THNK.players.clearPlayerTags(id);
        channel.close();
        return;
      }
      if (
        identity &&
        !this.bridge?.playerConnected(identity, transportConnectionId)
      ) {
        this.onDisconnection(id);
        THNK.players.clearPlayerTags(id);
        channel.close();
        return;
      }
      this.channels.set(id, channel);

      channel.on("error", (err) => logger.error("Channel error! ", err));
      channel.webrtcConnection.on("error", (err) =>
        logger.error("WebRTC error! ", err)
      );
      channel.dataChannel.onError((err) =>
        logger.error("Datachannel error! ", err)
      );
      channel.onRaw((message) => this.onMessage(id, message as Uint8Array));
      channel.onDisconnect(() => {
        this.onDisconnection(id);
        this.channels.delete(id);
        if (identity)
          this.bridge?.playerDisconnected(identity, transportConnectionId);
      });
    });

    this.httpServer = (
      electronRequire("http") as typeof import("http")
    ).createServer();
    this.httpServer.on("error", (err) =>
      logger.error("HTTP server error! ", err)
    );
    this.httpServer.on("clientError", (err) =>
      logger.error("HTTP server client-error! ", err)
    );
    this.server.addServer(this.httpServer);
    await new Promise<void>((resolve, reject) => {
      const onStartupError = (error: Error) => {
        this.httpServer?.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.httpServer?.off("error", onStartupError);
        resolve();
      };

      this.httpServer!.once("error", onStartupError);
      this.httpServer!.once("listening", onListening);
      this.httpServer!.listen(this.port);
    });

    // Force close the server when closing the preview window
    this.beforeUnloadHandler = () => this.close();
    window.addEventListener("beforeunload", this.beforeUnloadHandler);
  }

  close() {
    this.removeSessionEndingListener?.();
    this.removeSessionEndingListener = undefined;
    if (this.beforeUnloadHandler) {
      window.removeEventListener("beforeunload", this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }

    const httpServer = this.httpServer;
    this.httpServer = null;
    this.server = null;

    for (const connection of this.channels.values()) connection.close();
    this.channels.clear();

    if (!httpServer) return;
    if (httpServer.closeAllConnections) httpServer.closeAllConnections();
    if (httpServer.listening) httpServer.close();
  }

  protected doSendMessageTo(userID: string, message: Uint8Array): void {
    const connection = this.channels.get(userID);
    if (connection) {
      connection.raw.emit(
        message.buffer.slice(
          message.byteOffset,
          message.byteOffset + message.byteLength
        )
      );
    }
  }

  getServerID(): string {
    return this.connectionIDs.getServerID();
  }

  getServerIP() {
    const address = this.httpServer?.address();
    return typeof address === "string"
      ? address
      : address?.address ?? "unknown ip";
  }

  getServerPort() {
    const address = this.httpServer?.address();

    return (typeof address !== "string" && address?.port) || this.port;
  }
};
