FROM node:14.15.4

ADD . /app
WORKDIR /app

RUN npm run build && npm install:prod

EXPOSE 3000
CMD [ "node", "dist/main" ]
