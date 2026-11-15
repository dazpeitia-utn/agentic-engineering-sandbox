# Imagen del MCP remoto (proyecto 14). Se construye desde la RAÍZ del monorepo:
#   docker build -f projects/14-remote-mcp-server/Dockerfile -t monorepo-mcp .
#   docker run -p 3333:3333 -e MCP_PUBLIC_URL=https://mcp.tudominio.com -e MCP_OWNER_PASSWORD=... monorepo-mcp
#
# Se copia el monorepo entero (menos lo que excluye .dockerignore) porque el servidor usa
# workspaces (agent-core, 03, 05, 07) y npm ci valida el lockfile de todos.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY . .
RUN npm ci --no-audit --no-fund && npm cache clean --force
# Usuario sin privilegios.
USER node
ENV PORT=3333 HOST=0.0.0.0
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "projects/14-remote-mcp-server/src/index.ts"]
