#!/bin/bash
# Inicia el bot y lo reinicia si se cae (útil en Termux)
while true; do
  node index.js
  echo "El bot se detuvo. Reiniciando en 3s..."
  sleep 3
done
