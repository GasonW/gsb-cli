# API Contract Boundary

The platform repository owns the HTTP API. This CLI depends on the following stable API surface:

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/datasets`
- `POST /api/datasets/upload`
- `POST /api/tasks`
- `GET /api/tasks/{task_id}`
- `GET /api/tasks/{task_id}/preflight`
- `POST /api/tasks/{task_id}/publish`
- `POST /api/tasks/{task_id}/archive`
- `POST /tasks/{task_id}/api/select-dirs`
- `POST /tasks/{task_id}/api/setup`
- `POST /tasks/{task_id}/api/admin-config`
- `GET /tasks/{task_id}/api/renderer`
- `POST /tasks/{task_id}/api/renderer`
- `DELETE /tasks/{task_id}/api/renderer`
- `GET /tasks/{task_id}/api/reports`
- `GET /tasks/{task_id}/report/{file_name}`
- `GET /tasks/{task_id}/api/summary`
- `POST /tasks/{task_id}/api/export`

Compatibility rule:

1. Platform changes should be additive within `/api/v1` or the current unversioned equivalent.
2. CLI releases should pass tests against the latest platform test server before publishing.
3. Breaking API changes require a new API version and a CLI compatibility check in `gsb-cli doctor`.
