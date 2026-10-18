FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/protocol/package.json packages/protocol/package.json
# tsx is a pinned workspace root dev tool and is deliberately retained to execute TypeScript.
RUN npm ci --include=dev --workspace @beacon/api --workspace @beacon/protocol --include-workspace-root && npm cache clean --force
COPY apps/api apps/api
COPY packages/protocol packages/protocol
COPY database database
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm","--workspace","@beacon/api","start"]
