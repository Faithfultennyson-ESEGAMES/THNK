type VoiceBridge = {
  setVoiceChannel: (playerId: string, channelId: string) => Promise<unknown>;
  getPlayerVoiceChannel: (playerId: string) => string;
};

let bridge: VoiceBridge | undefined;

export const registerVoiceBridge = (value: VoiceBridge | undefined) => {
  bridge = value;
};

export const setPlayerVoiceChannel = (
  playerId: string,
  channelId: string
): Promise<unknown> => {
  if (!bridge)
    return Promise.reject(
      new Error(
        "THNK Set Voice Channel requires the exported session bridge runtime."
      )
    );
  return bridge.setVoiceChannel(playerId, channelId);
};

export const getPlayerVoiceChannel = (playerId: string): string =>
  bridge?.getPlayerVoiceChannel(playerId) ?? "";
