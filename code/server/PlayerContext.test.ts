import "tests-utils/gdjs-mock";
import {
  getCurrentPlayerTag,
  getCurrentPlayerVariableNumber,
  getCurrentPlayerVariableJSON,
  getPlayerDocument,
  markObjectAsOwned,
  pickOwnedObjects,
  releasePlayerContext,
  resetPlayerContexts,
  setPlayerTags,
  setPlayerDocument,
  setCurrentPlayerVariable,
  switchPlayerContext,
} from "server/PlayerContext";

class LongLivedObjectsList {
  private readonly objects = new Map<string, gdjs.RuntimeObject[]>();

  addObject(name: string, object: gdjs.RuntimeObject) {
    const list = this.objects.get(name) || [];
    list.push(object);
    this.objects.set(name, list);
  }

  getObjects(name: string) {
    return this.objects.get(name) || [];
  }
}

beforeAll(() => {
  Object.assign(
    (global as { gdjs?: object }).gdjs || ((global as any).gdjs = {}),
    {
      LongLivedObjectsList,
      copyArray(source: unknown[], destination: unknown[]) {
        destination.length = 0;
        destination.push(...source);
      },
    }
  );
});

test("exposes immutable matchmaking tags only in the selected player context", () => {
  const tags = { team: "A", seed: 7, captain: true };
  setPlayerTags("user-a", tags);
  tags.team = "tampered";

  switchPlayerContext("user-a");
  expect(getCurrentPlayerTag("team")).toBe("A");
  expect(getCurrentPlayerTag("seed")).toBe("7");
  expect(getCurrentPlayerTag("captain")).toBe("true");

  switchPlayerContext("user-b");
  expect(getCurrentPlayerTag("team")).toBe("");

  releasePlayerContext("user-a");
  switchPlayerContext("user-a");
  expect(getCurrentPlayerTag("team")).toBe("");
});

afterEach(resetPlayerContexts);

test("releases a disconnected user's owned-object context", () => {
  const object = { getName: () => "Player" } as gdjs.RuntimeObject;
  const picked: gdjs.RuntimeObject[] = [];
  const objectLists = {
    items: { Player: picked },
  } as unknown as ObjectsLists;

  switchPlayerContext("user-a");
  markObjectAsOwned(object);
  expect(pickOwnedObjects(objectLists)).toBe(true);
  expect(picked).toEqual([object]);

  releasePlayerContext("user-a");
  expect(pickOwnedObjects(objectLists)).toBe(false);
  expect(picked).toEqual([]);
});

test("reads and writes only the selected player's persistent document", () => {
  const writes: unknown[] = [];
  setPlayerDocument(
    "user-a",
    { progression: { xp: 7 }, inventory: ["sword"] },
    (document) => writes.push(document)
  );
  setPlayerDocument("user-b", { progression: { xp: 2 } });
  switchPlayerContext("user-a");
  expect(getCurrentPlayerVariableNumber("progression.xp")).toBe(7);
  expect(getCurrentPlayerVariableJSON("inventory")).toBe('["sword"]');

  const value = new gdjs.Variable();
  value.setNumber(8);
  expect(setCurrentPlayerVariable("progression.xp", value)).toBe(true);
  expect(getPlayerDocument("user-a")).toEqual({
    progression: { xp: 8 },
    inventory: ["sword"],
  });
  expect(writes).toEqual([getPlayerDocument("user-a")]);

  switchPlayerContext("user-b");
  expect(getCurrentPlayerVariableNumber("progression.xp")).toBe(2);
});

test("round-trips schema nulls without converting them to the string null", () => {
  const writes: unknown[] = [];
  setPlayerDocument(
    "user-a",
    {
      achievements: {
        first_overlap: {
          progress: 0,
          target: 1,
          unlocked: false,
          unlockedAt: null,
        },
      },
    },
    (document) => writes.push(document)
  );
  switchPlayerContext("user-a");
  expect(getPlayerDocument("user-a")).toEqual({
    achievements: {
      first_overlap: {
        progress: 0,
        target: 1,
        unlocked: false,
        unlockedAt: null,
      },
    },
  });

  const progress = new gdjs.Variable();
  progress.setNumber(1);
  expect(
    setCurrentPlayerVariable(
      "achievements.first_overlap.progress",
      progress
    )
  ).toBe(true);
  expect(writes.at(-1)).toMatchObject({
    achievements: { first_overlap: { progress: 1, unlockedAt: null } },
  });
});
