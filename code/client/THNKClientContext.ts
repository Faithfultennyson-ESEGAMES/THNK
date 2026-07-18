import type { ClientAdapter } from "adapters/Adapter";
import { ClientObjectsRegistery } from "client/ClientObjectsRegistery";

export class THNKClientContext {
  readonly adapter: ClientAdapter;
  readonly objectsRegistery: ClientObjectsRegistery;
  private readonly runtimeScene: gdjs.RuntimeScene;
  private authoritativeState: unknown;
  constructor(adapter: ClientAdapter, runtimeScene: gdjs.RuntimeScene) {
    this.adapter = adapter;
    this.runtimeScene = runtimeScene;
    this.objectsRegistery = new ClientObjectsRegistery(runtimeScene);
    this.authoritativeState = runtimeScene
      .getVariables()
      .get("State")
      .toJSObject();
  }

  captureAuthoritativeState() {
    this.authoritativeState = this.runtimeScene
      .getVariables()
      .get("State")
      .toJSObject();
    this.objectsRegistery.captureAuthoritativeState();
  }

  restoreAuthoritativeState() {
    this.runtimeScene
      .getVariables()
      .get("State")
      .fromJSObject(this.authoritativeState);
    this.objectsRegistery.restoreAuthoritativeState();
  }
}
