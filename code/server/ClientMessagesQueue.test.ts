import "tests-utils/gdjs-mock";
import {
  addRawMessageToTheQueue,
  clearMessages,
  popMessage,
  removeMessagesFromUser,
} from "server/ClientMessagesQueue";
import { getCurrentPlayerID } from "server/PlayerContext";

afterEach(clearMessages);

test("removes only the disconnected user's queued input", () => {
  const messageName = `identity-isolation-${Date.now()}`;
  const first = new gdjs.Variable().fromJSObject({ value: "first" });
  const second = new gdjs.Variable().fromJSObject({ value: "second" });
  const output = new gdjs.Variable();

  addRawMessageToTheQueue("user-a", messageName, first);
  addRawMessageToTheQueue("user-b", messageName, second);
  removeMessagesFromUser("user-a");

  expect(popMessage(messageName, output)).toBe(true);
  expect(getCurrentPlayerID()).toBe("user-b");
  expect(output.toJSObject()).toEqual({ value: "second" });
  expect(popMessage(messageName, output)).toBe(false);
});

test("clears queued input before a replacement server starts", () => {
  const output = new gdjs.Variable();
  addRawMessageToTheQueue(
    "old-session-user",
    "cross-session-input",
    new gdjs.Variable()
  );

  clearMessages();

  expect(popMessage("cross-session-input", output)).toBe(false);
});
