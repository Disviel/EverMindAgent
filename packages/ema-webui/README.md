# ema-webui

Mock-first Web UI for EverMemoryArchive.

This package is intentionally independent from the `ema` backend package during the first UI iteration. API routes under `/api/v1beta1` return mock data only.

## Development

From the workspace root:

```bash
pnpm webui
```

Or from this package directory:

```bash
pnpm start
```

Both commands run `next dev` for the prototype.
