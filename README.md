# Datasets Deputy

Composite dataset manager desktop app.

## MVP Scope

- Modern glass-style Tauri desktop shell.
- Native i18n foundation with `en-US` and `zh-CN` resources.
- SQLite-backed image, annotation profile, annotation, tag index, and export preset schema.
- Folder import, duplicate detection, thumbnail generation, and table browsing for large datasets.
- Manual tag/caption editing with one image mapped to multiple annotation profiles.
- Basic export support for `txt_per_image` and `jsonl`.

Python, WD14, VLLM, and remote API annotation are intentionally deferred. The database keeps `source_type` so those integrations can be added later without changing the core annotation model.

## Development

```bash
npm install
npm run dev
```

For the desktop app:

```bash
npm run tauri:dev
```

Rust and Cargo must be installed for Tauri commands and desktop builds.

## Release Layout

Use `npm run prepare:release -- <release-folder>` after packaging to normalize the release directory:

```text
ReleaseRoot/
├── DatasetsDeputy.exe
├── model/
├── config/
├── datasets/
├── runtime/
├── app/
├── log/
└── temp/
```

Logs are written in English under `log/`. Temporary thumbnails are stored under `temp/thumbnails/` by default; managed dataset projects can keep persistent thumbnails under `datasets/<project>/cache/thumbnails/`.
