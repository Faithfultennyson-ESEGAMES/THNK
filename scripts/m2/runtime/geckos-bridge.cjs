let geckosModule;

exports.loadGeckos = async () => {
  try {
    geckosModule ||= await import("@geckos.io/server");
  } catch (error) {
    console.error("THNK_GECKOS_IMPORT_FAILED", error);
    throw error;
  }
};

exports.createServer = (options) => {
  if (!geckosModule) throw new Error("Geckos was not loaded before use.");
  return geckosModule.geckos(options);
};
