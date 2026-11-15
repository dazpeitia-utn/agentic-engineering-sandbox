# Imagen del sandbox (proyecto 13): Node + Vitest para Linux, usuario sin privilegios.
#   docker build -t agentic-sandbox:latest projects/13-sandboxed-execution/image
#
# Vitest se instala en /node_modules: el workspace se monta en /workspace y la resolución
# de módulos de Node sube por los directorios hasta encontrarlo. (No se puede montar el
# node_modules del host: trae binarios nativos de otra plataforma, ej. esbuild de macOS.)
FROM node:22-slim
WORKDIR /
COPY package.json /package.json
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force \
 && ln -s /node_modules/.bin/vitest /usr/local/bin/vitest
# El usuario "node" (uid 1000) ya existe en la imagen base.
USER 1000:1000
WORKDIR /workspace
