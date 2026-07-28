import "tests-utils/gdjs-mock";
import { ClientObjectsRegistery } from "client/ClientObjectsRegistery";

const makeVariables = () => {
  const values = new Map<string, gdjs.Variable>();
  return {
    get(name: string) {
      let variable = values.get(name);
      if (!variable) {
        variable = new gdjs.Variable();
        values.set(name, variable);
      }
      return variable;
    },
  };
};

test("restores synchronized object properties changed by client events", () => {
  const variables = makeVariables();
  const properties = {
    x: 96,
    y: 240,
    angle: 0,
    width: 80,
    height: 28,
    layer: "",
    zOrder: 1,
  };
  const object = {
    getName() {
      return "Player";
    },
    getX() {
      return properties.x;
    },
    setX(value: number) {
      properties.x = value;
    },
    getY() {
      return properties.y;
    },
    setY(value: number) {
      properties.y = value;
    },
    getAngle() {
      return properties.angle;
    },
    setAngle(value: number) {
      properties.angle = value;
    },
    getWidth() {
      return properties.width;
    },
    setWidth(value: number) {
      properties.width = value;
    },
    getHeight() {
      return properties.height;
    },
    setHeight(value: number) {
      properties.height = value;
    },
    getLayer() {
      return properties.layer;
    },
    setLayer(value: string) {
      properties.layer = value;
    },
    getZOrder() {
      return properties.zOrder;
    },
    setZOrder(value: number) {
      properties.zOrder = value;
    },
    getVariables() {
      return variables;
    },
    deleteFromScene() {},
  } as unknown as gdjs.RuntimeObject;
  const registry = new ClientObjectsRegistery({} as gdjs.RuntimeScene);
  registry.registerObject(1, object);
  registry.captureAuthoritativeState();

  // Layer sorting and rendering behaviors are allowed to adjust presentation
  // order locally. It is restored from the Authority but is not a gameplay
  // trust incident.
  object.setZOrder(999);
  expect(registry.describeAuthoritativeEdits()).toEqual([]);

  object.setX(1096);
  object.setY(-1);
  object.getVariables().get("State").getChild("Score").setNumber(999);
  expect(registry.describeAuthoritativeEdits()).toEqual([
    "Player#1.x",
    "Player#1.y",
    "Player#1.State",
  ]);
  registry.restoreAuthoritativeState();

  expect(object.getX()).toBe(96);
  expect(object.getY()).toBe(240);
  expect(object.getZOrder()).toBe(1);
  expect(
    object.getVariables().get("State").getChild("Score").getAsNumber()
  ).toBe(0);
});

test("keeps the first object when a create message repeats an ID", () => {
  const firstObject = {
    deleteFromScene: jest.fn(),
  } as unknown as gdjs.RuntimeObject;
  const repeatedObject = {
    deleteFromScene: jest.fn(),
  } as unknown as gdjs.RuntimeObject;
  const runtimeScene = {} as gdjs.RuntimeScene;
  const registry = new ClientObjectsRegistery(runtimeScene);

  expect(registry.registerObject(2, firstObject)).toBe(firstObject);
  expect(registry.registerObject(2, repeatedObject)).toBe(firstObject);
  expect(registry.getObject(2)).toBe(firstObject);
  expect(firstObject.deleteFromScene).not.toHaveBeenCalled();
  expect(repeatedObject.deleteFromScene).toHaveBeenCalledWith(runtimeScene);
});
