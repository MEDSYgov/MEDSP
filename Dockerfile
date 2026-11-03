# ── مرحلة البناء: تحويل ملفات Excel وبناء الواجهة ──
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
# تحويل ملفات Excel يحتاج أكثر من 2 GB ذاكرة لـ Node
ENV NODE_OPTIONS=--max-old-space-size=6144
COPY . .
# البناء لا يحتاج أي متغير بيئة: الإعدادات تُقرأ من .env وقت التشغيل
RUN rm -f .env && npm run build

# ── مرحلة التشغيل: Node فقط، بلا أدوات بناء ──
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server-data ./server-data
#RUN find /app/server /app/dist /app/server-data -type d -exec chmod 755 {} + \
#    && find /app/server /app/dist /app/server-data -type f -exec chmod 644 {} +
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server/index.mjs"]
