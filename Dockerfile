FROM node:22-alpine AS app
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY mobile/package.json mobile/package.json
COPY admin/package.json admin/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci --include=dev
COPY . .
RUN npm run typecheck && npm run build
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["npm", "start"]
