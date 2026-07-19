import type { ClientAdapter } from "adapters/Adapter";
import { ClientObjectsRegistery } from "client/ClientObjectsRegistery";

export class THNKClientContext {
  readonly adapter: ClientAdapter;
  readonly objectsRegistery: ClientObjectsRegistery;
  private readonly runtimeScene: gdjs.RuntimeScene;
  private authoritativeState: unknown;
  private lastViolationReportAt = -Infinity;
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

  consumeAuthoritativeEditViolation(now = Date.now()): boolean {
    const sceneEdited =
      JSON.stringify(
        this.runtimeScene.getVariables().get("State").toJSObject()
      ) !== JSON.stringify(this.authoritativeState);
    if (!sceneEdited && !this.objectsRegistery.hasAuthoritativeEdits())
      return false;
    if (now - this.lastViolationReportAt < 5_000) return false;
    this.lastViolationReportAt = now;
    return true;
  }
}
