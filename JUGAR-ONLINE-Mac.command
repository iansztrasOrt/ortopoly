#!/bin/bash
# Doble clic para publicar Ortopoly con un link para tus amigos.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Falta Node.js. Se abre la página: instalá la versión LTS y volvé a abrir este archivo."
  open https://nodejs.org
  read -r -p "Enter para salir"
  exit 1
fi
[ -d node_modules ] || { echo "Instalando dependencias, es una sola vez..."; npm install --omit=dev; }
npm run online
