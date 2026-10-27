FROM node:24-alpine 

WORKDIR /app

# Run as the unprivileged node user and let it own /app: vite preview writes
# temp files into node_modules/ at startup.
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./

RUN npm ci

COPY --chown=node:node . .

# The browser calls ${VITE_API_URL}/api/v1/tasks. Baked in at build time.
ARG VITE_API_URL=http://localhost:8000
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

EXPOSE 8081
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "8081", "--strictPort"]

 


