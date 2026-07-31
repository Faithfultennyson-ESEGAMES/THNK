const delayAuthorityPoll = (milliseconds, setTimeoutImpl = setTimeout) =>
  new Promise((resolve) => {
    setTimeoutImpl(resolve, milliseconds);
  });

const startAuthorityHeartbeat = (
  callback,
  milliseconds = 15_000,
  setIntervalImpl = setInterval
) => setIntervalImpl(callback, milliseconds);

// Starting a session must never be able to hang the poll loop. A claim that
// never settles leaves the Authority alive but no longer polling, which never
// exits and so is never restarted; Matchmaking then answers every roster with
// authority_ready_timeout. Bounding it converts a hang into a normal failure.
const withAuthoritySessionTimeout = async (
  run,
  milliseconds = 20_000,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
) => {
  let timer;
  try {
    return await Promise.race([
      run(),
      new Promise((_resolve, reject) => {
        timer = setTimeoutImpl(
          () =>
            reject(
              Object.assign(new Error("authority session start timed out"), {
                code: "session_start_timeout",
              })
            ),
          milliseconds
        );
      }),
    ]);
  } finally {
    clearTimeoutImpl(timer);
  }
};

module.exports = {
  delayAuthorityPoll,
  startAuthorityHeartbeat,
  withAuthoritySessionTimeout,
};
