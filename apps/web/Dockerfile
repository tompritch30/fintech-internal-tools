# Local dev/CI image for the web app and the migrate job. Not a production image.
FROM node:24-slim
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @fit/web build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@fit/web", "start"]
