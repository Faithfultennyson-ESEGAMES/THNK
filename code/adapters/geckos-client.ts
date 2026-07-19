/// <reference path="../types/global.d.ts"/>
import { geckos, type ClientChannel } from "@geckos.io/client";
import { sessionVoice, type VoiceGrant } from "voice/AgoraSessionVoice";
const logger = new gdjs.Logger("THNK - Geckos.io Adapter");

THNK.GeckosClientAdapter = class GeckosClientAdapter extends (
  THNK.ClientAdapter
) {
  ip: string;
  port: number;
  authorization?: string;
  connection: ClientChannel | null = null;
  constructor(ip: string, port: number, admissionToken?: string) {
    super();
    this.ip = `http://${ip}`;
    this.port = port;
    const injectedToken = (
      globalThis as typeof globalThis & {
        THNK_ADMISSION_TOKEN?: string;
      }
    ).THNK_ADMISSION_TOKEN;
    const token = (admissionToken || injectedToken)?.trim();
    if (token) this.authorization = `Bearer ${token}`;
    if (!admissionToken && injectedToken)
      delete (
        globalThis as typeof globalThis & {
          THNK_ADMISSION_TOKEN?: string;
        }
      ).THNK_ADMISSION_TOKEN;
  }

  async prepare(): Promise<void> {
    this.connection = geckos({
      url: this.ip,
      port: this.port,
      label: "THNK",
      authorization: this.authorization,
    });
    await new Promise<void>((resolve, reject) =>
      this.connection!.onConnect((error) => {
        this.authorization = undefined;
        if (error) return reject(error.message);
        this.connection!.onRaw((message) =>
          this.onMessage(message as Uint8Array)
        );
        this.connection!.onDisconnect(() => {
          void sessionVoice.handleGameplayDisconnect();
          this.onDisconnection();
        });
        void sessionVoice.handleAdmission(
          (this.connection!.userData as { thnkVoice?: VoiceGrant })?.thnkVoice
        );
        resolve();
      })
    );
  }

  close() {
    if (this.connection) this.connection.close();
  }

  protected doSendMessage(message: Uint8Array): void {
    if (!this.connection) {
      return logger.error(
        "Tried to send a message on an unestablished connection!"
      );
    }
    this.connection.raw.emit(
      message.buffer.slice(
        message.byteOffset,
        message.byteOffset + message.byteLength
      )
    );
  }

  getServerIP() {
    return this.ip;
  }

  getServerPort() {
    return this.port;
  }
};
