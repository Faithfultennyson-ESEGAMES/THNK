export class ClientObjectsRegistery {
  private readonly objectsRegistery = new Map<number, gdjs.RuntimeObject>();
  private readonly authoritativeStates = new Map<
    number,
    {
      x: number;
      y: number;
      angle: number;
      width: number;
      height: number;
      layer: string;
      zOrder: number;
      state: unknown;
      playerState: unknown;
    }
  >();
  private readonly runtimeScene: gdjs.RuntimeScene;

  constructor(runtimeScene: gdjs.RuntimeScene) {
    this.runtimeScene = runtimeScene;
  }

  registerObject(id: number, runtimeObject: gdjs.RuntimeObject) {
    const existingObject = this.objectsRegistery.get(id);
    if (existingObject) {
      if (existingObject !== runtimeObject)
        runtimeObject.deleteFromScene(this.runtimeScene);
      return existingObject;
    }

    runtimeObject.thnkID = id;
    this.objectsRegistery.set(id, runtimeObject);
    return runtimeObject;
  }

  getObject(id: number) {
    return this.objectsRegistery.get(id);
  }

  deleteObject(id: number) {
    const obj = this.objectsRegistery.get(id);
    if (!obj) return;
    obj.deleteFromScene(this.runtimeScene);
    this.objectsRegistery.delete(id);
    this.authoritativeStates.delete(id);
  }

  captureAuthoritativeState() {
    for (const [id, object] of this.objectsRegistery) {
      this.authoritativeStates.set(id, {
        x: object.getX(),
        y: object.getY(),
        angle: object.getAngle(),
        width: object.getWidth(),
        height: object.getHeight(),
        layer: object.getLayer(),
        zOrder: object.getZOrder(),
        state: object.getVariables().get("State").toJSObject(),
        playerState: object.getVariables().get("PlayerState").toJSObject(),
      });
    }
  }

  restoreAuthoritativeState() {
    for (const [id, state] of this.authoritativeStates) {
      const object = this.objectsRegistery.get(id);
      if (!object) continue;
      object.setX(state.x);
      object.setY(state.y);
      object.setAngle(state.angle);
      object.setWidth(state.width);
      object.setHeight(state.height);
      object.setLayer(state.layer);
      object.setZOrder(state.zOrder);
      object.getVariables().get("State").fromJSObject(state.state);
      object.getVariables().get("PlayerState").fromJSObject(state.playerState);
    }
  }

  clear() {
    this.objectsRegistery.forEach((runtimeObject) =>
      runtimeObject.deleteFromScene(this.runtimeScene)
    );
    this.objectsRegistery.clear();
    this.authoritativeStates.clear();
  }
}
