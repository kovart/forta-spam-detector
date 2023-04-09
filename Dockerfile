# Build stage: compile Typescript to Javascript
FROM --platform=linux/x86_64 node:18.15-alpine AS builder
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build

# Final stage: copy compiled Javascript from previous stage and install production dependencies
FROM --platform=linux/x86_64 node:18.15-alpine
ENV NODE_ENV=production
# Uncomment the following line to enable agent logging
LABEL "network.forta.settings.agent-logs.enable"="true"
WORKDIR /app
COPY --from=builder /app/dist ./src
COPY .env.public .
COPY package*.json ./
COPY data ./
COPY LICENSE ./
RUN npm ci --production
CMD sh -c "source .env.public && npm run start:prod"