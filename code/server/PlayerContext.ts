let currentPlayerID: string = "";
const playerObjectsLists = new Map<string, gdjs.LongLivedObjectsList>();
type PlayerTag = string | number | boolean;
const playerTags = new Map<string, Readonly<Record<string, PlayerTag>>>();

export const getCurrentPlayerID = () => currentPlayerID;
export const switchPlayerContext = (playerID: string) => {
  currentPlayerID = playerID;
};
export const releasePlayerContext = (playerID: string) => {
  playerObjectsLists.delete(playerID);
  playerTags.delete(playerID);
  if (currentPlayerID === playerID) currentPlayerID = "";
};
export const resetPlayerContexts = () => {
  currentPlayerID = "";
  playerObjectsLists.clear();
  playerTags.clear();
};
export const setPlayerTags = (
  playerID: string,
  tags: Readonly<Record<string, PlayerTag>> = {}
) => playerTags.set(playerID, Object.freeze({ ...tags }));
export const clearPlayerTags = (playerID: string) =>
  playerTags.delete(playerID);
export const getCurrentPlayerTag = (name: string): string => {
  const value = playerTags.get(currentPlayerID)?.[name];
  return value === undefined ? "" : String(value);
};
export const markObjectAsOwned = (object: gdjs.RuntimeObject) => {
  let lists = playerObjectsLists.get(currentPlayerID);
  if (!lists)
    playerObjectsLists.set(
      currentPlayerID,
      (lists = new gdjs.LongLivedObjectsList())
    );

  lists.addObject(object.getName(), object);
};

export const pickOwnedObjects = (
  objectsListsHashtable: ObjectsLists
): boolean => {
  const playerLists = playerObjectsLists.get(currentPlayerID);
  if (!playerLists) {
    // No objects lists exist for that player, don't pick any objects and return false.
    for (const objectList of Object.values(objectsListsHashtable.items))
      objectList.length = 0;
    return false;
  }

  for (const [objectName, objectList] of Object.entries(
    objectsListsHashtable.items
  )) {
    gdjs.copyArray(playerLists.getObjects(objectName), objectList);
  }

  return true;
};
