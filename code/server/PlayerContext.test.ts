import {
  getCurrentPlayerTag,
  markObjectAsOwned,
  pickOwnedObjects,
  releasePlayerContext,
  resetPlayerContexts,
  setPlayerTags,
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
