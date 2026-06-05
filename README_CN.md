# Datasets Deputy

[English](README.md) | 简体中文

<img width="1344" height="768" alt="DatasetsDeputy" src="https://github.com/user-attachments/assets/b5b61cbb-388d-4524-be1e-8a3673b38a4a" />

Datasets Deputy 是一个面向图像训练集整理、标注、检查与导出的桌面工具。它基于 Tauri 2、React、TypeScript、Rust 和 SQLite 构建，目标是在本地桌面环境里把图片预览、文件夹管理、多版本标注、批量处理、AI 辅助标注和训练前检查整合到一个工作台中。

当前项目仍处于开发阶段。功能和数据结构会优先服务源码整洁、性能和真实工作流，在结束Beta状态前，不承诺向后兼容。

## 当前能力

- 图像数据集浏览：导入或挂载图片文件夹后，以左侧项目树、网格视图、表格视图和单图预览管理数据。
- 多来源数据模式：支持资产数据库、动态链接数据库和工作文件夹三种模式，覆盖长期归档、索引管理和直接编辑文件夹等不同工作流。
- 标注与指令编辑：支持单图标注、表格批量编辑、未保存状态提示、退出防丢失确认，以及按标注类型管理不同模型或用途的标注版本。
- 批量文本处理：支持批量添加字段、查找替换、标注标准化、Booru Tag / Anima / 自然语言之间的格式转换与自然语言重写。
- AI 辅助标注：支持 Gemini、OpenAI、Anthropic、Grok，也支持本地 LM Studio、Ollama、Textgen 等后端，同时支持 WD14 架构的 Tagger。
- 本地模型辅助：可配置 Python 运行时、托管 venv、WD14 模型、CLIP 相似度模型，以及 PyTorch / ONNX Runtime 相关依赖。
- 训练前工具：包含图片格式校验、训练缓存清理、重复/相似图片检测。
- 导入导出：支持数据集导入导出、SQLite 数据库导入/导出，以及带图片的数据库压缩包。
- 历史记录：常见文本编辑、批量处理、标注类型和文件组织操作支持撤销/重做。


## 数据模式

### 资产数据库

资产数据库会把源图片复制到程序管理的资产库中，并用 SQLite 保存图片索引、标注类型、标注内容和指令。它适合长期归档、跨设备迁移、避免源路径丢失影响数据集的场景。

### 动态链接数据库

动态链接数据库用 SQLite 管理图片索引、标注类型、标注内容和指令，但图片仍从原始路径读取。它适合图片文件仍会频繁调整，而标注需要由 Datasets Deputy 统一管理的场景。

### 工作文件夹

工作文件夹模式直接挂载本地文件夹，尽量贴近资源管理器逻辑。标注写入图片同目录的同名 `.txt` 文件，单图指令写入同名 `.inst.txt` 文件。移除挂载路径不会删除本地文件；但在工作文件夹内执行真实删除或重命名时，会同步处理对应图片、标注和指令文件。

目前支持扫描的图片扩展名包括 `jpg`、`jpeg`、`png`、`webp`、`bmp`、`gif`。

## 标注后端

远程与本地 LLM 后端：

- Gemini API
- OpenAI API
- Anthropic API
- Grok API
- LM Studio
- Ollama
- Textgen

本地图像标签：

- WD14 Tagger，支持 ONNX 或 PyTorch / Hugging Face 风格模型目录。
- 可配置通用标签阈值、角色标签阈值、是否加入角色/版权标签、是否把下划线替换为空格。

部分功能需要在设置里先配置 Python 运行时和模型路径。相似图片检测依赖 CLIP 图像向量模型；WD14 批量标注依赖 Python、Pillow、NumPy，以及对应的 PyTorch 或 ONNX Runtime 环境。

## 导入、导出与文件布局

数据集导出会复制图片并为每张图片生成对应 `.txt` 标注文件。工作文件夹模式会使用该文件夹内现有的 TXT 标注；数据库模式会按所选标注类型导出。

数据库导出支持两种形式：

- 仅数据库：导出单个 `.sqlite` 文件，继续引用数据库中记录的原始图片路径。
- 包含图片：导出 `.zip` 压缩包，包含 `database.sqlite` 和 `images/` 下的图片副本。

运行时目录由可执行文件所在目录派生：

```text
DatasetsDeputy/
├─ DatasetsDeputy.exe
├─ model/        # 本地模型
├─ config/       # API、代理、Python、模型、缩略图等设置
├─ datasets/     # 程序管理的数据集资产
├─ runtime/      # SQLite 数据库、托管 Python venv 等运行时资源
├─ app/          # 打包后的应用资源
├─ log/          # 日志
└─ temp/         # 缩略图、相似度缓存、临时文件
```

## 开发

日常开发优先使用根目录脚本：

```powershell
.\dev.ps1
```

常用参数：

- `.\dev.ps1 -Install`：先安装前端依赖再启动。
- `.\dev.ps1 -WebOnly`：只启动 Vite 前端开发服务器。
- `.\dev.ps1 -ResetCache`：重置脚本缓存后再启动。

底层 npm / Tauri 命令仍然可用：

```bash
npm install
npm run dev
npm run tauri:dev
npm run build
npm run tauri:build
```

开发桌面端需要安装 Rust、Cargo 和 Tauri 所需的系统依赖。Vite 开发服务器默认由 Tauri 配置拉起，端口见 `src-tauri/tauri.conf.json`。

## 发布整理

发布构建优先使用根目录脚本：

```powershell
.\publish.ps1
```

常用参数：

- `.\publish.ps1 -Clean`：发布前清理输出目录。
- `.\publish.ps1 -Install`：先安装前端依赖再发布。
- `.\publish.ps1 -Bundle`：生成发布目录后再打包 zip。
- `.\publish.ps1 -OutputDir <release-folder>`：指定发布目录，默认是 `release/DatasetsDeputy`。
- `.\publish.ps1 -ZipPath <zip-path>`：指定 zip 输出路径，默认是 `release/DatasetsDeputy.zip`。

脚本会构建桌面应用并整理发布目录，创建 `model`、`config`、`datasets`、`runtime`、`app`、`log`、`temp` 等目录。底层发布整理脚本仍可通过 `npm run prepare:release -- <release-folder>` 单独调用。

## 主要技术栈

- 桌面框架：Tauri 2
- 前端：React 19、TypeScript、Vite、Tailwind CSS
- 状态管理：Zustand
- 表格与虚拟列表：TanStack Table、TanStack Virtual
- 动画与图标：Framer Motion、Lucide React
- 后端：Rust、Tokio、Rayon、rusqlite、notify、image
- 本地推理辅助：Python、PyTorch、ONNX Runtime、Transformers、Pillow、NumPy
