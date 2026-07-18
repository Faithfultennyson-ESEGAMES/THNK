/** Set to true to disable client code. This is meant for dedicated servers. */
let DEDICATED = false;

/** The amount of target ticks per second. */
let TICK_RATE = 20;

export const setDedicated = () => {
  DEDICATED = true;
};

export const setTickRate = (newTPS: number) => {
  TICK_RATE = Math.max(1, newTPS);
};

export const getTickRate = () => TICK_RATE;
export const isDedicated = () => DEDICATED;
