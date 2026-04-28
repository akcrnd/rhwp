# Dokploy deployment notes

Use `Dockerfile.dokploy` to deploy the `rhwp-studio` web app.

## Build context

- Repository root

## Dockerfile path

- `Dockerfile.dokploy`

## Exposed container port

- `80`

## What this Dockerfile does

1. Builds the Rust/WASM package with `wasm-pack` into `pkg/`
2. Builds `rhwp-studio` with Vite
3. Serves the built app with Nginx

