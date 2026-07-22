let currentPlayerID: string = "";
const playerObjectsLists = new Map<string, gdjs.LongLivedObjectsList>();
type PlayerTag = string | number | boolean;
const playerTags = new Map<string, Readonly<Record<string, PlayerTag>>>();
const playerDocuments = new Map<string, gdjs.Variable>();
const playerDocumentNullPaths = new Map<string, ReadonlySet<string>>();
const playerDocumentWriters = new Map<string, (document: unknown) => void>();
const watchedFields = new Set<string>();
const pendingVariableChanges: Array<{ playerID: string; path: string }> = [];

const collectNullPaths = (
  value: unknown,
  path = "",
  paths = new Set<string>()
): Set<string> => {
  if (value === null) paths.add(path);
  else if (Array.isArray(value))
    value.forEach((child, index) =>
      collectNullPaths(child, path ? `${path}.${index}` : String(index), paths)
    );
  else if (value && typeof value === "object")
    for (const [name, child] of Object.entries(value))
      collectNullPaths(child, path ? `${path}.${name}` : name, paths);
  return paths;
};

const restoreNullPaths = (
  value: unknown,
  nullPaths: ReadonlySet<string>,
  path = ""
): unknown => {
  if (nullPaths.has(path) && value === "null") return null;
  if (Array.isArray(value))
    return value.map((child, index) =>
      restoreNullPaths(child, nullPaths, path ? `${path}.${index}` : String(index))
    );
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([name, child]) => [
        name,
        restoreNullPaths(child, nullPaths, path ? `${path}.${name}` : name),
      ])
    );
  return value;
};

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

const serializeWatchedField = (playerID: string, path: string): string =>
  JSON.stringify(getDocumentVariable(playerID, path)?.toJSObject() ?? null);

const snapshotWatchedFields = (playerID: string): Map<string, string> => {
  const snapshot = new Map<string, string>();
  for (const path of watchedFields)
    snapshot.set(path, serializeWatchedField(playerID, path));
  return snapshot;
};

const enqueueWatchedFieldChanges = (
  playerID: string,
  before: Map<string, string>
) => {
  for (const [path, previous] of before)
    if (serializeWatchedField(playerID, path) !== previous)
      pendingVariableChanges.push({ playerID, path });
};

export const watchPlayerVariable = (path: string) => {
  if (path) watchedFields.add(path);
};

export const popPlayerVariableChange = (path: string): boolean => {
  if (!path) return false;
  watchedFields.add(path);
  const index = pendingVariableChanges.findIndex(
    (change) => change.path === path
  );
  if (index < 0) return false;
  const [change] = pendingVariableChanges.splice(index, 1);
  currentPlayerID = change!.playerID;
  return true;
};

export const getCurrentPlayerID = () => currentPlayerID;
export const switchPlayerContext = (playerID: string) => {
  currentPlayerID = playerID;
};
export const releasePlayerContext = (playerID: string) => {
  playerObjectsLists.delete(playerID);
  playerTags.delete(playerID);
  playerDocuments.delete(playerID);
  playerDocumentNullPaths.delete(playerID);
  playerDocumentWriters.delete(playerID);
  for (let index = pendingVariableChanges.length - 1; index >= 0; index -= 1)
    if (pendingVariableChanges[index]!.playerID === playerID)
      pendingVariableChanges.splice(index, 1);
  if (currentPlayerID === playerID) currentPlayerID = "";
};
export const resetPlayerContexts = () => {
  currentPlayerID = "";
  playerObjectsLists.clear();
  playerTags.clear();
  playerDocuments.clear();
  playerDocumentNullPaths.clear();
  playerDocumentWriters.clear();
  watchedFields.clear();
  pendingVariableChanges.length = 0;
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
  const before = playerDocuments.has(playerID)
    ? snapshotWatchedFields(playerID)
    : undefined;
  const variable = new gdjs.Variable();
  variable.fromJSObject(document);
  playerDocuments.set(playerID, variable);
  playerDocumentNullPaths.set(playerID, collectNullPaths(document));
  if (before) enqueueWatchedFieldChanges(playerID, before);
  if (onChange) playerDocumentWriters.set(playerID, onChange);
};
export const getPlayerDocument = (playerID: string): unknown =>
  restoreNullPaths(
    playerDocuments.get(playerID)?.toJSObject() || {},
    playerDocumentNullPaths.get(playerID) || new Set()
  );
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
  const before = snapshotWatchedFields(currentPlayerID);
  gdjs.Variable.copy(value, target);
  enqueueWatchedFieldChanges(currentPlayerID, before);
  playerDocumentWriters.get(currentPlayerID)?.(
    getPlayerDocument(currentPlayerID)
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
