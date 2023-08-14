# Build stage: compile Typescript to Javascript
FROM node:18.15-alpine AS builder
WORKDIR /app
COPY . .
RUN apk add --no-cache linux-headers python3 make g++ && rm -rf /var/cache/apk/*
RUN npm ci --loglevel verbose
RUN npm run build --loglevel verbose

# Final stage: copy compiled Javascript from previous stage and install production dependencies
FROM --platform=linux/x86_64 node:18.15-alpine
ENV NODE_ENV=production
# Uncomment the following line to enable agent logging
LABEL "network.forta.settings.agent-logs.enable"="true"
WORKDIR /app
COPY --from=builder /app/dist ./src
COPY .env.public .
COPY package*.json ./
COPY data ./data
COPY LICENSE ./
RUN apk add --no-cache linux-headers python3 make g++ && rm -rf /var/cache/apk/*
RUN npm ci --production --loglevel verbose
CMD sh -c "source .env.public && npm run start:prod"