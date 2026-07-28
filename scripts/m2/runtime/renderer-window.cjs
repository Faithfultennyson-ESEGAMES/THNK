const resolveRendererVisible = (value) => {
  const normalized = value === undefined || value === "" ? "true" : value;
  if (normalized !== "true" && normalized !== "false")
    throw new Error("THNK_AUTHORITY_RENDER_VISIBLE must be true or false.");
  return normalized === "true";
};

module.exports = { resolveRendererVisible };
