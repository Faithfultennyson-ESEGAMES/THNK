FROM node:24.18.0-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    dumb-init \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    libxss1 \
    xauth \
    xvfb \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/thnk-server
COPY package.json yarn.lock ./

RUN test "$(yarn --version)" = "1.22.22" \
  && yarn install --frozen-lockfile --production=true --non-interactive \
  && node node_modules/electron/install.js \
  && useradd --create-home --uid 10001 thnk

COPY . ./

RUN chown root:root node_modules/electron/dist/chrome-sandbox \
  && chmod 4755 node_modules/electron/dist/chrome-sandbox

USER thnk
ENV NODE_ENV=production
EXPOSE 9208/tcp 9208/udp 9209/tcp

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.THNK_CONTROL_PORT||9209)+'/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["xvfb-run", "-a", "--server-args=-screen 0 1024x768x24", "node_modules/.bin/electron", "--no-sandbox", "."]
