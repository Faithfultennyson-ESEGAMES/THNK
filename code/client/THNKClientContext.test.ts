import "tests-utils/gdjs-mock";
import { type ClientAdapter } from "adapters/Adapter";
import { THNKClientContext } from "client/THNKClientContext";

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

test("restores scene State changed by client events", () => {
  const variables = makeVariables();
  const scene = {
    getVariables: () => variables,
  } as unknown as gdjs.RuntimeScene;
  const context = new THNKClientContext({} as ClientAdapter, scene);
  const score = variables.get("State").getChild("Score");

  score.setNumber(2);
  context.captureAuthoritativeState();
  score.setNumber(999);
  context.restoreAuthoritativeState();

  expect(variables.get("State").getChild("Score").getAsNumber()).toBe(2);
});
