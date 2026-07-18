import { getCurrentPlayerID } from "server/PlayerContext";
import { PlayerManager } from "server/PlayersManager";

test("keeps many user transitions distinct and idempotent", () => {
  const manager = new PlayerManager();
  const users = Array.from({ length: 128 }, (_, index) => `user-${index}`);

  for (const user of users) {
    expect(manager._onConnect(user)).toBe(true);
    expect(manager._onConnect(user)).toBe(false);
  }
  expect(manager.connectedPlayers).toEqual(new Set(users));

  const connectedOrder: string[] = [];
  while (manager.popConnection()) connectedOrder.push(getCurrentPlayerID());
  expect(connectedOrder).toEqual(users);

  const disconnected = users.filter((_, index) => index % 2 === 0);
  for (const user of disconnected) {
    expect(manager._onDisconnect(user)).toBe(true);
    expect(manager._onDisconnect(user)).toBe(false);
  }

  const disconnectedOrder: string[] = [];
  while (manager.popDisconnection())
    disconnectedOrder.push(getCurrentPlayerID());
  expect(disconnectedOrder).toEqual(disconnected);
  expect(manager.connectedPlayers).toEqual(
    new Set(users.filter((_, index) => index % 2 === 1))
  );
});
