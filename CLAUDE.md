# CLAUDE.md — Instrucciones del proyecto

## Versionado obligatorio antes de instalar

Antes de ejecutar el build e instalarlo en Homebridge, **siempre debes actualizar la versión del paquete** en `package.json`.

Esto es necesario porque Homebridge cachea el paquete instalado. Si la versión no cambia, el navegador seguirá mostrando la versión anterior aunque el build sea distinto.

### Pasos obligatorios al probar cambios

1. Actualiza la versión en `package.json` (ej. `3.1.1-local.15` → `3.1.1-local.16`)
2. Ejecuta el build:
   ```bash
   npm run build
   ```
3. Empaqueta e instala:
   ```bash
   npm pack && sudo hb-service install homebridge-simpler-wled-<nueva-versión>.tgz
   ```
4. Reinicia Homebridge y recarga el navegador para verificar los cambios.

> Sin el cambio de versión, no podrás confirmar que tus cambios están activos en el navegador.
