# ---------- BUILD STAGE ----------
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Prisma generate
RUN npx prisma generate

RUN npm run build


# ---------- PRODUCTION ----------
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

# Install ONLY production deps
RUN npm install --omit=dev

# Copy built files + prisma client
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/index.js"]