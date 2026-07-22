export type GeckosEndpoint = {
  url: string;
  port: number | null;
};

export const normalizeGeckosEndpoint = (
  address: string,
  port: number | null
): GeckosEndpoint => {
  const value = String(address || "").trim();
  if (!value) throw new Error("THNK Geckos server address is required");

  if (!/^https?:\/\//i.test(value)) {
    return { url: `http://${value.replace(/\/+$/, "")}`, port };
  }

  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error("THNK Geckos server URL must use HTTP or HTTPS");
  if (parsed.username || parsed.password)
    throw new Error("THNK Geckos server URL must not contain credentials");
  if (parsed.search || parsed.hash)
    throw new Error("THNK Geckos server URL must not contain a query or fragment");

  return { url: value.replace(/\/+$/, ""), port };
};

export const endpointPort = ({ url, port }: GeckosEndpoint): number => {
  if (port !== null) return port;
  const parsed = new URL(url);
  if (parsed.port) return Number(parsed.port);
  return parsed.protocol === "https:" ? 443 : 80;
};
