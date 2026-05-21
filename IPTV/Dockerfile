# Cambia la versión aquí arriba a la 1.60.0
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

COPY package*.json ./

RUN npm install

# Asegura la descarga correcta de la shell de chromium de esta versión
RUN npx playwright install chromium --with-deps

COPY . .

EXPOSE 3000

CMD ["node", "bot.js"]
