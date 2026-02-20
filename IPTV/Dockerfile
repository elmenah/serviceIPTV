# Usamos la imagen oficial de Playwright que ya tiene Chrome
FROM mcr.microsoft.com/playwright:v1.58.2-jammy

# Crear carpeta de la app
WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias
RUN npm install

# Copiar el resto del código
COPY . .

# Exponer el puerto del bot
EXPOSE 3000

# Comando para iniciar
CMD ["node", "bot.js"]