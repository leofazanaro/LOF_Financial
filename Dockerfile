# Painel Financeiro em contêiner. O banco e as faturas importadas ficam em /app/data (monte um volume).
FROM node:24-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public
COPY scripts ./scripts

RUN mkdir -p data && chown node:node data
USER node

VOLUME /app/data
EXPOSE 3000

# Qualquer resposta abaixo de 500 (inclusive 401, com senha) indica que o servidor está de pé.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))"

CMD ["node", "src/server.js"]
