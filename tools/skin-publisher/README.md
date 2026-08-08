# Turtle Monitor Skin Publisher

This is a developer-only Electron tool. It is intentionally excluded from the Turtle Monitor application build.

## Source workflow

From the repository root, install dependencies and configure Wrangler once on the developer machine:

```powershell
npm ci
Copy-Item subscription-service/wrangler.toml.example subscription-service/wrangler.toml
# Fill the local Wrangler file with the real D1/R2 configuration.
npx wrangler login
npm run skin-publisher
```

The tool searches for the repository two directories above its source location. Set `TURTLE_SKIN_REPOSITORY` when launching a standalone copy located elsewhere. The publish action uses the local Wrangler profile; no token is stored in the tool.

## Standalone portable tool

```powershell
npm run dist:skin-publisher
```

When using the portable executable, set `TURTLE_SKIN_REPOSITORY` to the checked-out project directory so built-in skin writes and the private Wrangler configuration resolve correctly.
