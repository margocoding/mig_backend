# --- Development Stage ---
FROM node:22-alpine AS development

WORKDIR /usr/src/app

COPY package*.json ./
COPY yarn*.lock ./

RUN yarn install

COPY . .

RUN yarn prisma generate
RUN yarn run build

# --- Production Stage ---
FROM node:22-alpine AS production

ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

WORKDIR /usr/src/app

COPY package*.json ./
COPY yarn*.lock ./

RUN yarn install --production

COPY . .

COPY --from=development /usr/src/app/node_modules/.prisma /usr/src/app/node_modules/.prisma
COPY --from=development /usr/src/app/node_modules/@prisma /usr/src/app/node_modules/@prisma

COPY --from=development /usr/src/app/dist ./dist

EXPOSE 3000

CMD ["sh", "-c", "yarn prisma migrate deploy && yarn run start:prod"]
