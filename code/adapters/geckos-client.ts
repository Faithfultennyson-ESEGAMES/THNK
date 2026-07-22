/// <reference path="../types/global.d.ts"/>
import { geckos, type ClientChannel } from "@geckos.io/client";
import {
  endpointPort,
  geckosConnectionEndpoint,
  normalizeGeckosEndpoint,
} from "adapters/geckos-client-endpoint";
import { sessionVoice, type VoiceGrant } from "voice/AgoraSessionVoice";
const logger = new gdjs.Logger("THNK - Geckos.io Adapter");

THNK.GeckosClientAdapter = class GeckosClientAdapter extends (
  THNK.ClientAdapter
) {
  ip: string;
  port: number | null;
  authorization?: string;
  connection: ClientChannel | null = null;
  constructor(ip: string, port: number | null, admissionToken?: string) {
    super();
    const endpoint = normalizeGeckosEndpoint(ip, port);
    this.ip = endpoint.url;
    this.port = endpoint.port;
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
      ...geckosConnectionEndpoint({ url: this.ip, port: this.port }),
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
        const admission = this.connection!.userData as {
          thnkIdentity?: { playerId?: string };
          thnkPlayerDocument?: unknown;
        };
        if (admission.thnkIdentity?.playerId) {
          THNK.players.setPlayerDocument(
            admission.thnkIdentity.playerId,
            admission.thnkPlayerDocument || {}
          );
          THNK.players.switchPlayerContext(admission.thnkIdentity.playerId);
        }
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
    this.connection.raw.emit(message);
  }

  getServerIP() {
    return this.ip;
  }

  getServerPort() {
    return endpointPort({ url: this.ip, port: this.port });
  }
};
