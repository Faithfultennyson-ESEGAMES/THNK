import { ConnectionIDFactory } from "adapters/ConnectionID";

test("creates role-separated IDs that stay unique even with a repeated UUID", () => {
  const factory = new ConnectionIDFactory(() => "fixed-random-value");
  const serverID = factory.getServerID();
  const clientIDs = Array.from({ length: 10_000 }, () =>
    factory.createClientID()
  );

  expect(new Set(clientIDs).size).toBe(clientIDs.length);
  expect(clientIDs).not.toContain(serverID);
  expect(clientIDs[0]).toContain(":client:0");
  expect(clientIDs.at(-1)).toContain(":client:9999");
});

test("separates IDs produced by different server sessions", () => {
  let sequence = 0;
  const randomUUID = () => `random-${sequence++}`;
  const first = new ConnectionIDFactory(randomUUID);
  const second = new ConnectionIDFactory(randomUUID);

  expect(first.getServerID()).not.toBe(second.getServerID());
  expect(first.createClientID()).not.toBe(second.createClientID());
});
