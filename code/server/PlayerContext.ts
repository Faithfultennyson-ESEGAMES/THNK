let currentPlayerID: string = "";
const playerObjectsLists = new Map<string, gdjs.LongLivedObjectsList>();
type PlayerTag = string | number | boolean;
const playerTags = new Map<string, Readonly<Record<string, PlayerTag>>>();
const playerDocuments = new Map<string, gdjs.Variable>();
const playerDocumentWriters = new Map<string, (document: unknown) => void>();

const getDocumentVariable = (
  playerID: string,
  path: string,
  create = false
) => {
  const document = playerDocuments.get(playerID);
  if (!document) return undefined;
  if (!path) return document;
  let variable = document;
  for (const name of path.split(".").filter(Boolean)) {
    if (!create) {
      if (variable.getType() === "array") {
        const index = Number(name);
        const children = variable.getAllChildrenArray();
        if (!Number.isInteger(index) || index < 0 || index >= children.length)
          return undefined;
        variable = children[index];
        continue;
      }
      if (!variable.hasChild(name)) return undefined;
    }
    variable = variable.getChild(name);
  }
  return variable;
};

export const getCurrentPlayerID = () => currentPlayerID;
export const switchPlayerContext = (playerID: string) => {
  currentPlayerID = playerID;
};
export const releasePlayerContext = (playerID: string) => {
  playerObjectsLists.delete(playerID);
  playerTags.delete(playerID);
  playerDocuments.delete(playerID);
  playerDocumentWriters.delete(playerID);
  if (currentPlayerID === playerID) currentPlayerID = "";
};
export const resetPlayerContexts = () => {
  currentPlayerID = "";
  playerObjectsLists.clear();
  playerTags.clear();
  playerDocuments.clear();
  playerDocumentWriters.clear();
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
export const setPlayerDocument = (
  playerID: string,
  document: unknown = {},
  onChange?: (document: unknown) => void
) => {
  const variable = new gdjs.Variable();
  variable.fromJSObject(document);
  playerDocuments.set(playerID, variable);
  if (onChange) playerDocumentWriters.set(playerID, onChange);
};
export const getPlayerDocument = (playerID: string): unknown =>
  playerDocuments.get(playerID)?.toJSObject() || {};
export const getCurrentPlayerVariableNumber = (path: string): number =>
  getDocumentVariable(currentPlayerID, path)?.getAsNumber() || 0;
export const getCurrentPlayerVariableString = (path: string): string =>
  getDocumentVariable(currentPlayerID, path)?.getAsString() || "";
export const getCurrentPlayerVariableBoolean = (path: string): boolean =>
  getDocumentVariable(currentPlayerID, path)?.getAsBoolean() || false;
export const getCurrentPlayerVariableJSON = (path: string): string =>
  JSON.stringify(
    getDocumentVariable(currentPlayerID, path)?.toJSObject() ?? null
  );
export const setCurrentPlayerVariable = (
  path: string,
  value: gdjs.Variable
): boolean => {
  if (!currentPlayerID || !path || !playerDocuments.has(currentPlayerID))
    return false;
  const target = getDocumentVariable(currentPlayerID, path, true);
  if (!target) return false;
  gdjs.Variable.copy(value, target);
  playerDocumentWriters.get(currentPlayerID)?.(
    playerDocuments.get(currentPlayerID)!.toJSObject()
  );
  return true;
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
