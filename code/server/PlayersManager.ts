import {
  releasePlayerContext,
  resetPlayerContexts,
  switchPlayerContext,
} from "server/PlayerContext";
export class PlayerManager {
  readonly connectedPlayers = new Set<string>();
  private readonly connectionsQueue: string[] = [];
  private readonly disconnectionsQueue: string[] = [];
  private readonly consumedDisconnections: string[] = [];

  _onConnect(id: string): boolean {
    if (this.connectedPlayers.has(id)) return false;
    this.connectedPlayers.add(id);
    this.connectionsQueue.push(id);
    return true;
  }
  _onDisconnect(id: string): boolean {
    if (!this.connectedPlayers.delete(id)) return false;
    this.disconnectionsQueue.push(id);
    return true;
  }

  alreadyHas(id: string): boolean {
    return this.connectedPlayers.has(id);
  }

  popConnection() {
    if (this.connectionsQueue.length) {
      switchPlayerContext(this.connectionsQueue.shift()!);
      return true;
    }

    return false;
  }

  popDisconnection() {
    if (this.disconnectionsQueue.length) {
      const playerID = this.disconnectionsQueue.shift()!;
      switchPlayerContext(playerID);
      this.consumedDisconnections.push(playerID);
      return true;
    }

    return false;
  }

  finalizeDisconnections() {
    for (const playerID of this.consumedDisconnections)
      releasePlayerContext(playerID);
    this.consumedDisconnections.length = 0;
  }

  clear() {
    this.connectedPlayers.clear();
    this.connectionsQueue.length = 0;
    this.disconnectionsQueue.length = 0;
    this.consumedDisconnections.length = 0;
    resetPlayerContexts();
  }
}
