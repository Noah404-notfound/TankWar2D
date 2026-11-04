# One public HTTP(S) endpoint for both the browser client and the game socket.
# Render (and other PaaS providers) supplies PORT at runtime; nginx is the only
# process exposed outside the container, while the Haskell server remains on
# its private loopback port 8080.
FROM haskell:9.6.7 AS builder

WORKDIR /build
ENV PATH="/opt/ghc/9.6.7/bin:${PATH}"

COPY deploy/cabal.config /root/.config/cabal/config
COPY deploy/curl-retry.sh /usr/local/bin/curl
COPY tankwar.cabal ./
COPY src ./src
COPY server ./server
RUN chmod 755 /usr/local/bin/curl
RUN cabal update --verbose=2
RUN cabal build exe:tankwar-server \
    && mkdir -p /out \
    && cp "$(cabal list-bin exe:tankwar-server)" /out/tankwar-server

FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install --no-install-recommends -y \
      ca-certificates \
      gettext-base \
      libgmp10 \
      libnuma1 \
      netbase \
      nginx \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default

COPY --from=builder /out/tankwar-server /usr/local/bin/tankwar-server
COPY web /usr/share/nginx/html
COPY deploy/nginx.conf.template /etc/nginx/nginx.conf.template
COPY deploy/start-tankwar.sh /usr/local/bin/start-tankwar

RUN chmod 755 /usr/local/bin/start-tankwar

ENV PORT=10000
EXPOSE 10000

ENTRYPOINT ["/usr/local/bin/start-tankwar"]
