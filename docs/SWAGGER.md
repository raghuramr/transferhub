# API docs (Swagger / OpenAPI)

- **UI:** `<app>/api/docs`  - e.g. `https://codecrafters-eacpe4a9bqg9gadt.southindia-01.azurewebsites.net/api/docs`
- **JSON spec:** `<app>/api/docs-json` (import into Postman / Insomnia / codegen)
- Local: `http://localhost:3001/api/docs`

## Turning it on
| Environment | Default | Control |
|---|---|---|
| development (`NODE_ENV` not `production`) | on | `SWAGGER_ENABLED=false` turns it off |
| production (Azure) | **off** | set App Service setting `SWAGGER_ENABLED=true` and restart |

Optional protection in front of the docs: set `SWAGGER_USER` and `SWAGGER_PASSWORD` (HTTP basic auth on `/api/docs` and `/api/docs-json`).
Remove `SWAGGER_ENABLED` (or set `false`) after the demo - the docs list every endpoint.

## Getting a Bearer token
1. Open `/api/docs`, expand **auth -> POST /api/auth/login**, press *Try it out*, send
   `{ "email": "super_admin@bu.edu", "password": "SuperAdmin@123!" }` (demo accounts: see CLAUDE.md).
2. Copy `accessToken` from the response body.
3. Press **Authorize** (top right), paste the token (no `Bearer ` prefix), Authorize. It is remembered across page reloads.
4. Calls now send `Authorization: Bearer <token>`. When it expires (401), log in again or call `POST /api/auth/refresh` with the `refreshToken`.

Same thing with curl:
```
curl -s -X POST https://<app>/api/auth/login -H "Content-Type: application/json" -d '{"email":"admin@bu.edu","password":"Admin@123!"}'
curl -s https://<app>/api/transfers/summary -H "Authorization: Bearer <accessToken>"
```

## Notes
- Operations are grouped by the first path segment (auth, users, transfers, ...), generated automatically.
- Request-body schemas are not shown (DTOs have no `@ApiProperty` decorators; the build is plain `tsc`, so the Swagger CLI plugin is not used). Use the DTOs in `src/api/src/**/dto` or the feature docs in `docs/`.
- Public endpoints (login, register, demo-login, universities) work without a token; the Authorize header is simply ignored there.
