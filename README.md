# Datasets Deputy

English | [简体中文](README_CN.md)

<img width="1344" height="768" alt="DatasetsDeputy" src="https://github.com/user-attachments/assets/b5b61cbb-388d-4524-be1e-8a3673b38a4a" />

Datasets Deputy is a desktop workspace for organizing, annotating, checking, and exporting image training datasets. It is built with Tauri 2, React, TypeScript, Rust, and SQLite, and aims to bring image preview, folder management, multi-version annotations, batch editing, AI-assisted annotation, and pre-training checks into one local tool.

The project is still under active development. Before it leaves Beta, features and data structures prioritize clean source code, performance, and real workflows over backward compatibility.

## Features

- Dataset browsing: import or mount image folders, then work through a project tree, grid view, table view, and single-image preview.
- Multiple data modes: asset databases, dynamic linked databases, and workspace folders cover archival, indexed, and direct folder-editing workflows.
- Annotation and instruction editing: edit per-image annotations, table drafts, unsaved states, exit guards, and multiple annotation types for different models or targets.
- Batch text operations: add fields, find and replace text, normalize annotations, convert between Booru Tag / Anima / natural language formats, and rewrite natural-language annotations.
- AI-assisted annotation: supports Gemini, OpenAI, Anthropic, Grok, local LM Studio, Ollama, Textgen, and WD14-style taggers.
- Local model support: configure Python runtimes, managed virtual environments, WD14 models, CLIP similarity models, and PyTorch / ONNX Runtime dependencies.
- Pre-training tools: image format validation, training cache cleanup, and duplicate / similar image detection.
- Import and export: dataset import/export, SQLite database import/export, and database zip packages with images.
- History: undo and redo for common text edits, batch actions, annotation type operations, and file organization operations.

## Data Modes

### Asset Database

Asset databases copy source images into the app-managed asset library and store image indexes, annotation types, annotation text, and instructions in SQLite. This mode fits long-term archives, cross-device migration, and datasets that should not depend on the original source paths.

### Dynamic Linked Database

Dynamic linked databases store image indexes, annotation types, annotation text, and instructions in SQLite while reading images from their original paths. This mode fits datasets whose images still change frequently while annotations need to be managed centrally by Datasets Deputy.

### Workspace Folder

Workspace folders mount a local folder directly and stay close to native file-manager behavior. Annotations are written as same-name `.txt` files beside each image, and per-image instructions are written as same-name `.inst.txt` files. Removing a mounted path does not delete local files, while real delete or rename operations inside a workspace folder also update the related image, annotation, and instruction files.

Currently supported image extensions are `jpg`, `jpeg`, `png`, `webp`, `bmp`, and `gif`.

## Annotation Backends

Remote and local LLM backends:

- Gemini API
- OpenAI API
- Anthropic API
- Grok API
- LM Studio
- Ollama
- Textgen

Local image tagging:

- WD14 Tagger, with ONNX or PyTorch / Hugging Face-style model folders.
- Configurable general tag threshold, character tag threshold, character/copyright tag inclusion, and underscore replacement.

Some features require configuring a Python runtime and model paths first. Similar image detection depends on a CLIP image embedding model. WD14 batch annotation depends on Python, Pillow, NumPy, and either PyTorch or ONNX Runtime.

## Import, Export, And Layout

Dataset export copies images and writes one `.txt` annotation file per image. Workspace folder mode exports from existing TXT annotations in the folder; database modes export the selected annotation type.

Database export supports two modes:

- Database only: exports a single `.sqlite` file and keeps referencing the original image paths recorded in the database.
- With images: exports a `.zip` package containing `database.sqlite` and image copies under `images/`.

Runtime folders are derived from the executable location:

```text
DatasetsDeputy/
|-- DatasetsDeputy.exe
|-- model/        # Local models
|-- config/       # API, proxy, Python, model, thumbnail, and other settings
|-- datasets/     # App-managed dataset assets
|-- runtime/      # SQLite databases, managed Python venv, and runtime resources
|-- app/          # Packaged app resources
|-- log/          # Logs
`-- temp/         # Thumbnails, similarity cache, and temporary files
```

## Development

For daily development, prefer the root script:

```powershell
.\dev.ps1
```

Common options:

- `.\dev.ps1 -Install`: install frontend dependencies before starting.
- `.\dev.ps1 -WebOnly`: start only the Vite frontend dev server.
- `.\dev.ps1 -ResetCache`: reset the script cache before starting.

The underlying npm / Tauri commands are still available:

```bash
npm install
npm run dev
npm run tauri:dev
npm run build
npm run tauri:build
```

Desktop development requires Rust, Cargo, and the system dependencies required by Tauri. The Vite dev server is started through the Tauri config by default; see `src-tauri/tauri.conf.json` for the port.

## Publishing

For release builds, prefer the root script:

```powershell
.\publish.ps1
```

Common options:

- `.\publish.ps1 -Clean`: clean the output directory before publishing.
- `.\publish.ps1 -Install`: install frontend dependencies before publishing.
- `.\publish.ps1 -Bundle`: create a zip package after generating the release directory.
- `.\publish.ps1 -OutputDir <release-folder>`: choose the release directory. The default is `release/DatasetsDeputy`.
- `.\publish.ps1 -ZipPath <zip-path>`: choose the zip output path. The default is `release/DatasetsDeputy.zip`.

The script builds the desktop app and prepares the release directory with `model`, `config`, `datasets`, `runtime`, `app`, `log`, and `temp` folders. The lower-level release layout script can still be called directly with `npm run prepare:release -- <release-folder>`.

## Tech Stack

- Desktop framework: Tauri 2
- Frontend: React 19, TypeScript, Vite, Tailwind CSS
- State management: Zustand
- Tables and virtualization: TanStack Table, TanStack Virtual
- Animation and icons: Framer Motion, Lucide React
- Backend: Rust, Tokio, Rayon, rusqlite, notify, image
- Local inference support: Python, PyTorch, ONNX Runtime, Transformers, Pillow, NumPy
