import {
  Check,
  ChevronDown,
  Boxes,
  Globe2,
  HardDrive,
  ImageUp,
  Languages,
  MonitorCog,
  Network,
  Server,
  Settings2,
  Trash2,
  Waypoints,
  Wifi,
  X
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";

import i18next from "../../i18n";
import { cn } from "../../lib/cn";
import { formatAppError } from "../../lib/errors";
import { formatBytes } from "../../lib/format";
import { hasTauriRuntime, invokeCommand } from "../../lib/tauri";
import {
  getBottomUiOpacity,
  getThemePreference,
  getTopUiOpacity,
  getUiAnimationPreference,
  setThemePreference,
  setBottomUiOpacity,
  setTopUiOpacity,
  setUiAnimationPreference,
  watchUiOpacity,
  watchUiAnimationPreference,
  watchThemePreference,
  type ThemePreference,
  type UiAnimationPreference
} from "../../lib/theme";
import { useDatasetStore } from "../../stores/datasetStore";
import { AnimatedPortal, useAnimatedPortalClose } from "../ui/AnimatedPortal";
import { AppSelect } from "../ui/AppSelect";
import { Button } from "../ui/Button";
import { HierarchyDisclosureButton } from "../ui/HierarchyDisclosureButton";
import { Slider } from "../ui/Slider";
import { Switch } from "../ui/Switch";

type SettingsSectionKey =
  | "general"
  | "language"
  | "network"
  | "localFiles"
  | "appearance";
type NetworkSectionKey =
  | "gemini"
  | "openai"
  | "anthropic"
  | "grok"
  | "doubao"
  | "qwen"
  | "zhipu"
  | "llmLoader"
  | "proxy"
  | "imageTransfer";
type LocalFilesSectionKey = "environment" | "models" | "tempFiles";

interface SettingsSection {
  key: SettingsSectionKey;
  labelKey: string;
  icon: typeof Settings2;
}

type ChildIcon =
  | { kind: "lucide"; icon: typeof Settings2 }
  | { kind: "svg"; src: string; alt: string };

interface SettingsChildItem<T extends string> {
  key: T;
  label: string;
  icon: ChildIcon;
}

const providerIcons = {
  gemini: new URL("../../../assets/svg/googlegemini.svg", import.meta.url).href,
  openai: new URL("../../../assets/svg/openai.svg", import.meta.url).href,
  anthropic: new URL("../../../assets/svg/anthropic.svg", import.meta.url).href,
  grok: new URL("../../../assets/svg/grok.svg", import.meta.url).href,
  doubao: new URL("../../../assets/svg/bytedance.svg", import.meta.url).href,
  qwen: new URL("../../../assets/svg/qwen.svg", import.meta.url).href,
  zhipu: new URL("../../../assets/svg/zhipu.svg", import.meta.url).href
};

const sections: SettingsSection[] = [
  { key: "general", labelKey: "settings.general", icon: Settings2 },
  { key: "language", labelKey: "settings.language", icon: Languages },
  { key: "network", labelKey: "settings.network", icon: Wifi },
  { key: "localFiles", labelKey: "settings.localFiles", icon: HardDrive },
  { key: "appearance", labelKey: "settings.appearance", icon: MonitorCog }
];

const languageOptions = [
  { value: "zh-CN", labelKey: "settings.simplifiedChinese" },
  { value: "en-US", labelKey: "settings.english" }
];

const themeOptions: Array<{ value: ThemePreference; labelKey: string }> = [
  { value: "system", labelKey: "settings.themeSystem" },
  { value: "light", labelKey: "settings.themeLight" },
  { value: "dark", labelKey: "settings.themeDark" }
];

const uiAnimationOptions: Array<{ value: UiAnimationPreference; labelKey: string }> = [
  { value: "system", labelKey: "settings.uiAnimationSystem" },
  { value: "on", labelKey: "settings.uiAnimationOn" },
  { value: "off", labelKey: "settings.uiAnimationOff" }
];

type RemoteRequestMode = "queue" | "concurrent";

const requestModeOptions: Array<{ value: RemoteRequestMode; labelKey: string }> = [
  { value: "queue", labelKey: "settings.requestModeQueue" },
  { value: "concurrent", labelKey: "settings.requestModeConcurrent" }
];

interface GeminiSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  availableModels: string[];
  targetRpm: number;
  requestMode: RemoteRequestMode;
  imageResizeMode: string;
  imageConvertFormat: string;
}

interface RemoteLlmSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  availableModels: string[];
  targetRpm: number;
  requestMode: RemoteRequestMode;
}

type RemoteLlmProvider = "openai" | "anthropic" | "grok" | "doubao" | "qwen" | "zhipu";

interface ProxySettings {
  useProxy: boolean;
  proxyPort: string;
}

interface LlmLoaderEndpointSettings {
  baseUrl: string;
}

interface LlmLoaderSettings {
  lmStudio: LlmLoaderEndpointSettings;
  textgen: LlmLoaderEndpointSettings;
  ollama: LlmLoaderEndpointSettings;
}

type PythonEnvMode = "externalVenv" | "managedVenv";
type PythonEnvInstallProfile = "cpu" | "cuda128" | "cuda130";
type OnnxRuntimeInstallProfile = "cpu" | "cuda" | "directml";

interface PythonEnvSettings {
  mode: PythonEnvMode;
  externalPath: string;
  managedPath: string;
  installProfile: PythonEnvInstallProfile;
  onnxInstallProfile: OnnxRuntimeInstallProfile;
}

interface PythonEnvProbeReport {
  ok: boolean;
  mode: PythonEnvMode;
  pythonPath?: string;
  managedPath: string;
  pythonAvailable: boolean;
  pythonVersion?: string;
  torchAvailable: boolean;
  torchVersion?: string;
  torchError?: string;
  cudaAvailable: boolean;
  cudaVersion?: string;
  deviceNames: string[];
  onnxRuntimeAvailable: boolean;
  onnxRuntimeVersion?: string;
  onnxRuntimeProviders: string[];
  onnxRuntimeError?: string;
  error?: string;
  stdout: string;
  stderr: string;
}

interface PythonEnvInstallResult {
  success: boolean;
  message: string;
  managedPath: string;
  pythonPath?: string;
  stdout: string;
  stderr: string;
}

interface ModelSettings {
  wd14Tagger: Wd14TaggerSettings;
  clipSimilarity: ClipSimilaritySettings;
}

interface ModelPathSelection {
  path: string;
  modelType: Wd14TaggerSettings["modelType"];
}

interface ClipSimilaritySettings {
  modelPath: string;
}

interface Wd14TaggerSettings {
  modelPath: string;
  modelType: "pytorch" | "onnx" | "unknown";
  addCharacterTags: boolean;
  addCopyrightTags: boolean;
  replaceUnderscoresWithSpaces: boolean;
  generalThreshold: number;
  characterThreshold: number;
}

interface ThumbnailCacheInfo {
  sizeBytes: number;
}

interface ThumbnailSettings {
  thumbnailSize: number;
}

interface LogFilesInfo {
  sizeBytes: number;
}

const defaultGeminiSettings: GeminiSettings = {
  apiKey: "",
  baseUrl: "",
  model: "gemini-flash-latest",
  availableModels: ["gemini-flash-latest", "gemini-pro-latest"],
  targetRpm: 5,
  requestMode: "queue",
  imageResizeMode: "none",
  imageConvertFormat: "none"
};

const defaultOpenAiSettings: RemoteLlmSettings = {
  apiKey: "",
  baseUrl: "",
  model: "gpt-5.5",
  availableModels: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"],
  targetRpm: 5,
  requestMode: "queue"
};

const defaultAnthropicSettings: RemoteLlmSettings = {
  apiKey: "",
  baseUrl: "",
  model: "claude-sonnet-4-6",
  availableModels: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"],
  targetRpm: 5,
  requestMode: "queue"
};

const defaultGrokSettings: RemoteLlmSettings = {
  apiKey: "",
  baseUrl: "",
  model: "grok-4.3",
  availableModels: [
    "grok-4.3",
    "grok-4.3-latest",
    "grok-4.20",
    "grok-4.20-reasoning",
    "grok-4.20-reasoning-latest",
    "grok-4.20-0309",
    "grok-4.20-0309-reasoning",
    "grok-4.20-non-reasoning",
    "grok-4.20-non-reasoning-latest",
    "grok-4.20-0309-non-reasoning"
  ],
  targetRpm: 5,
  requestMode: "queue"
};

const defaultDoubaoSettings: RemoteLlmSettings = {
  apiKey: "",
  baseUrl: "",
  model: "doubao-seed-2-0-lite-260215",
  availableModels: ["doubao-seed-2-0-lite-260215"],
  targetRpm: 5,
  requestMode: "queue"
};

const defaultQwenSettings: RemoteLlmSettings = {
  apiKey: "",
  baseUrl: "",
  model: "qwen3-vl-flash",
  availableModels: [
    "qwen3-vl-flash",
    "qwen3-vl-plus",
    "qwen-vl-plus",
    "qwen-vl-plus-latest",
    "qwen-vl-max",
    "qwen-vl-max-latest"
  ],
  targetRpm: 5,
  requestMode: "queue"
};

const defaultZhipuSettings: RemoteLlmSettings = {
  apiKey: "",
  baseUrl: "",
  model: "glm-4.5v",
  availableModels: [
    "glm-4.5v",
    "glm-4.6v",
    "glm-4.6v-flash",
    "glm-4.7",
    "glm-4.7-flash",
    "glm-4.5-flash"
  ],
  targetRpm: 5,
  requestMode: "queue"
};

const remoteLlmProviderMetadata: Record<
  RemoteLlmProvider,
  {
    titleKey: string;
    descriptionKey: string;
    apiKeyPlaceholderKey: string;
    baseUrlPlaceholder: string;
  }
> = {
  openai: {
    titleKey: "settings.openAiApi",
    descriptionKey: "settings.openAiApiDescription",
    apiKeyPlaceholderKey: "settings.openAiApiKeyPlaceholder",
    baseUrlPlaceholder: "https://api.openai.com/v1"
  },
  anthropic: {
    titleKey: "settings.anthropicApi",
    descriptionKey: "settings.anthropicApiDescription",
    apiKeyPlaceholderKey: "settings.anthropicApiKeyPlaceholder",
    baseUrlPlaceholder: "https://api.anthropic.com"
  },
  grok: {
    titleKey: "settings.grokApi",
    descriptionKey: "settings.grokApiDescription",
    apiKeyPlaceholderKey: "settings.grokApiKeyPlaceholder",
    baseUrlPlaceholder: "https://api.x.ai/v1"
  },
  doubao: {
    titleKey: "settings.doubaoApi",
    descriptionKey: "settings.doubaoApiDescription",
    apiKeyPlaceholderKey: "settings.doubaoApiKeyPlaceholder",
    baseUrlPlaceholder: "https://ark.cn-beijing.volces.com/api/v3"
  },
  qwen: {
    titleKey: "settings.qwenApi",
    descriptionKey: "settings.qwenApiDescription",
    apiKeyPlaceholderKey: "settings.qwenApiKeyPlaceholder",
    baseUrlPlaceholder: "https://dashscope.aliyuncs.com/compatible-mode/v1"
  },
  zhipu: {
    titleKey: "settings.zhipuApi",
    descriptionKey: "settings.zhipuApiDescription",
    apiKeyPlaceholderKey: "settings.zhipuApiKeyPlaceholder",
    baseUrlPlaceholder: "https://open.bigmodel.cn/api/paas/v4"
  }
};

const defaultProxySettings: ProxySettings = {
  useProxy: false,
  proxyPort: "7890"
};

const defaultLlmLoaderSettings: LlmLoaderSettings = {
  lmStudio: { baseUrl: "" },
  textgen: { baseUrl: "" },
  ollama: { baseUrl: "" }
};

const llmLoaderDefaults = {
  lmStudio: { label: "LM Studio", port: "1234" },
  textgen: { label: "Textgen", port: "5005" },
  ollama: { label: "Ollama", port: "11434" }
};

const defaultPythonEnvSettings: PythonEnvSettings = {
  mode: "managedVenv",
  externalPath: "",
  managedPath: "",
  installProfile: "cuda128",
  onnxInstallProfile: "directml"
};

const defaultModelSettings: ModelSettings = {
  wd14Tagger: {
    modelPath: "",
    modelType: "unknown",
    addCharacterTags: true,
    addCopyrightTags: false,
    replaceUnderscoresWithSpaces: true,
    generalThreshold: 0.7,
    characterThreshold: 0.9
  },
  clipSimilarity: {
    modelPath: ""
  }
};

const defaultThumbnailSettings: ThumbnailSettings = {
  thumbnailSize: 256
};

const thumbnailSizeOptions = [
  { value: "128", label: "128 px" },
  { value: "192", label: "192 px" },
  { value: "256", label: "256 px" },
  { value: "384", label: "384 px" },
  { value: "512", label: "512 px" }
];

const pythonEnvModeOptions: Array<{ value: PythonEnvMode; labelKey: string }> = [
  { value: "managedVenv", labelKey: "settings.pythonEnvModeManaged" },
  { value: "externalVenv", labelKey: "settings.pythonEnvModeExternal" }
];

const pythonInstallProfileOptions: Array<{
  value: PythonEnvInstallProfile;
  labelKey: string;
}> = [
  { value: "cuda128", labelKey: "settings.pythonInstallCuda128" },
  { value: "cuda130", labelKey: "settings.pythonInstallCuda130" },
  { value: "cpu", labelKey: "settings.pythonInstallCpu" }
];

const onnxInstallProfileOptions: Array<{
  value: OnnxRuntimeInstallProfile;
  labelKey: string;
}> = [
  { value: "directml", labelKey: "settings.onnxInstallDirectml" },
  { value: "cuda", labelKey: "settings.onnxInstallCuda" },
  { value: "cpu", labelKey: "settings.onnxInstallCpu" }
];

const resizeOptions = [
  { value: "none", labelKey: "settings.geminiResizeNone" },
  { value: "loose", labelKey: "settings.geminiResizeLoose" },
  { value: "normal", labelKey: "settings.geminiResizeNormal" },
  { value: "high", labelKey: "settings.geminiResizeHigh" },
  { value: "extreme", labelKey: "settings.geminiResizeExtreme" }
];

const convertFormatOptions = [
  { value: "none", labelKey: "settings.geminiFormatNone" },
  { value: "webp", labelKey: "settings.geminiFormatWebp" },
  { value: "jpeg", labelKey: "settings.geminiFormatJpeg" }
];


interface SettingsDialogProps {
  onClose: () => void;
}

function EditableModelSelect({
  value,
  options,
  onChange
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const normalizedOptions = Array.from(new Set([value, ...options].filter(Boolean)));

  useEffect(() => {
    if (!open) return;

    const close = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        containerRef.current?.contains(event.target)
      ) {
        return;
      }
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="no-drag relative">
      <div className="glass-input flex h-8 w-full items-center gap-1 rounded-md px-2.5">
        <input
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-neutral-900 outline-none"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-400 transition hover:bg-neutral-900/5 hover:text-neutral-700"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <ChevronDown size={14} className={cn("transition", open && "rotate-180")} />
        </button>
      </div>

      {open ? (
        <div className="app-dropdown-menu absolute left-0 top-9 z-[70] max-h-56 min-w-full overflow-y-auto rounded-lg py-2">
          <div className="app-dropdown-backdrop" />
          {normalizedOptions.map((option) => {
            const selected = option === value;
            return (
              <button
                key={option}
                type="button"
                className={cn(
                  "app-dropdown-item flex h-9 w-full items-center gap-2 px-3.5 text-left text-[13px] font-medium transition hover:bg-neutral-100",
                  selected ? "text-neutral-950" : "text-neutral-600"
                )}
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
              >
                <span className="flex w-4 shrink-0 justify-center">
                  {selected ? <Check size={14} /> : null}
                </span>
                <span className="min-w-0 flex-1 truncate">{option}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SettingsTreeIcon({ icon }: { icon: ChildIcon }) {
  if (icon.kind === "svg") {
    return (
      <span
        className="h-4 w-4 shrink-0 bg-current"
        aria-label={icon.alt}
        role="img"
        style={{
          WebkitMask: `url("${icon.src}") center / contain no-repeat`,
          mask: `url("${icon.src}") center / contain no-repeat`,
          transform: "scale(1.2)",
          transformOrigin: "center"
        }}
      />
    );
  }

  const Icon = icon.icon;
  return <Icon size={16} className="shrink-0 text-current" />;
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const { i18n, t } = useTranslation();
  const { open, close } = useAnimatedPortalClose(onClose);
  const [activeSection, setActiveSection] = useState<SettingsSectionKey>("general");
  const [activeNetworkSection, setActiveNetworkSection] =
    useState<NetworkSectionKey>("gemini");
  const [activeLocalFilesSection, setActiveLocalFilesSection] =
    useState<LocalFilesSectionKey>("environment");
  const [expandedSettingsSections, setExpandedSettingsSections] = useState<Set<SettingsSectionKey>>(
    () => new Set(["network", "localFiles"])
  );
  const [themePreference, setThemePreferenceState] =
    useState<ThemePreference>(getThemePreference);
  const [uiAnimationPreference, setUiAnimationPreferenceState] =
    useState<UiAnimationPreference>(getUiAnimationPreference);
  const [bottomUiOpacity, setBottomUiOpacityState] = useState(getBottomUiOpacity);
  const [topUiOpacity, setTopUiOpacityState] = useState(getTopUiOpacity);
  const [geminiSettings, setGeminiSettings] =
    useState<GeminiSettings>(defaultGeminiSettings);
  const [geminiMessage, setGeminiMessage] = useState("");
  const [isGeminiBusy, setIsGeminiBusy] = useState(false);
  const [hasLoadedGeminiSettings, setHasLoadedGeminiSettings] = useState(false);
  const [proxySettings, setProxySettings] =
    useState<ProxySettings>(defaultProxySettings);
  const [proxyMessage, setProxyMessage] = useState("");
  const [hasLoadedProxySettings, setHasLoadedProxySettings] = useState(false);
  const [llmLoaderSettings, setLlmLoaderSettings] =
    useState<LlmLoaderSettings>(defaultLlmLoaderSettings);
  const [llmLoaderMessage, setLlmLoaderMessage] = useState("");
  const [hasLoadedLlmLoaderSettings, setHasLoadedLlmLoaderSettings] = useState(false);
  const [openAiSettings, setOpenAiSettings] =
    useState<RemoteLlmSettings>(defaultOpenAiSettings);
  const [openAiMessage, setOpenAiMessage] = useState("");
  const [isOpenAiBusy, setIsOpenAiBusy] = useState(false);
  const [hasLoadedOpenAiSettings, setHasLoadedOpenAiSettings] = useState(false);
  const [anthropicSettings, setAnthropicSettings] =
    useState<RemoteLlmSettings>(defaultAnthropicSettings);
  const [anthropicMessage, setAnthropicMessage] = useState("");
  const [isAnthropicBusy, setIsAnthropicBusy] = useState(false);
  const [hasLoadedAnthropicSettings, setHasLoadedAnthropicSettings] = useState(false);
  const [grokSettings, setGrokSettings] =
    useState<RemoteLlmSettings>(defaultGrokSettings);
  const [grokMessage, setGrokMessage] = useState("");
  const [isGrokBusy, setIsGrokBusy] = useState(false);
  const [hasLoadedGrokSettings, setHasLoadedGrokSettings] = useState(false);
  const [doubaoSettings, setDoubaoSettings] =
    useState<RemoteLlmSettings>(defaultDoubaoSettings);
  const [doubaoMessage, setDoubaoMessage] = useState("");
  const [isDoubaoBusy, setIsDoubaoBusy] = useState(false);
  const [hasLoadedDoubaoSettings, setHasLoadedDoubaoSettings] = useState(false);
  const [qwenSettings, setQwenSettings] =
    useState<RemoteLlmSettings>(defaultQwenSettings);
  const [qwenMessage, setQwenMessage] = useState("");
  const [isQwenBusy, setIsQwenBusy] = useState(false);
  const [hasLoadedQwenSettings, setHasLoadedQwenSettings] = useState(false);
  const [zhipuSettings, setZhipuSettings] =
    useState<RemoteLlmSettings>(defaultZhipuSettings);
  const [zhipuMessage, setZhipuMessage] = useState("");
  const [isZhipuBusy, setIsZhipuBusy] = useState(false);
  const [hasLoadedZhipuSettings, setHasLoadedZhipuSettings] = useState(false);
  const [pythonEnvSettings, setPythonEnvSettings] =
    useState<PythonEnvSettings>(defaultPythonEnvSettings);
  const [pythonEnvProbe, setPythonEnvProbe] = useState<PythonEnvProbeReport>();
  const [pythonEnvMessage, setPythonEnvMessage] = useState("");
  const [isPythonEnvBusy, setIsPythonEnvBusy] = useState(false);
  const [hasLoadedPythonEnvSettings, setHasLoadedPythonEnvSettings] = useState(false);
  const [modelSettings, setModelSettings] =
    useState<ModelSettings>(defaultModelSettings);
  const [modelSettingsMessage, setModelSettingsMessage] = useState("");
  const [isModelSettingsBusy, setIsModelSettingsBusy] = useState(false);
  const [hasLoadedModelSettings, setHasLoadedModelSettings] = useState(false);
  const [thumbnailSettings, setThumbnailSettings] =
    useState<ThumbnailSettings>(defaultThumbnailSettings);
  const [hasLoadedThumbnailSettings, setHasLoadedThumbnailSettings] = useState(false);
  const {
    highlightCellState,
    autoSaveAfterAnnotation,
    autoSaveAfterBatch,
    setHighlightCellState,
    setAutoSaveAfterAnnotation,
    setAutoSaveAfterBatch,
    refreshImages,
    bumpThumbnailCacheKey
  } = useDatasetStore(
    useShallow((state) => ({
      highlightCellState: state.highlightCellState,
      autoSaveAfterAnnotation: state.autoSaveAfterAnnotation,
      autoSaveAfterBatch: state.autoSaveAfterBatch,
      setHighlightCellState: state.setHighlightCellState,
      setAutoSaveAfterAnnotation: state.setAutoSaveAfterAnnotation,
      setAutoSaveAfterBatch: state.setAutoSaveAfterBatch,
      refreshImages: state.refreshImages,
      bumpThumbnailCacheKey: state.bumpThumbnailCacheKey
    }))
  );
  const [thumbnailCacheInfo, setThumbnailCacheInfo] =
    useState<ThumbnailCacheInfo>({ sizeBytes: 0 });
  const [logFilesInfo, setLogFilesInfo] = useState<LogFilesInfo>({ sizeBytes: 0 });
  const [isTemporaryFilesBusy, setIsTemporaryFilesBusy] = useState(false);
  const [localFilesMessage, setLocalFilesMessage] = useState("");
  const active = sections.find((section) => section.key === activeSection) ?? sections[0];
  const networkChildItems: Array<SettingsChildItem<NetworkSectionKey>> = [
    {
      key: "gemini",
      label: t("settings.networkGemini"),
      icon: { kind: "svg", src: providerIcons.gemini, alt: "Gemini" }
    },
    {
      key: "openai",
      label: t("settings.networkOpenAi"),
      icon: { kind: "svg", src: providerIcons.openai, alt: "OpenAI" }
    },
    {
      key: "anthropic",
      label: t("settings.networkAnthropic"),
      icon: { kind: "svg", src: providerIcons.anthropic, alt: "Anthropic" }
    },
    {
      key: "grok",
      label: t("settings.networkGrok"),
      icon: { kind: "svg", src: providerIcons.grok, alt: "Grok" }
    },
    {
      key: "doubao",
      label: t("settings.networkDoubao"),
      icon: { kind: "svg", src: providerIcons.doubao, alt: "ByteDance" }
    },
    {
      key: "qwen",
      label: t("settings.networkQwen"),
      icon: { kind: "svg", src: providerIcons.qwen, alt: "Qwen" }
    },
    {
      key: "zhipu",
      label: t("settings.networkZhipu"),
      icon: { kind: "svg", src: providerIcons.zhipu, alt: "Zhipu" }
    },
    {
      key: "llmLoader",
      label: t("settings.networkLlmLoader"),
      icon: { kind: "lucide", icon: Server }
    },
    {
      key: "proxy",
      label: t("settings.networkProxyShort"),
      icon: { kind: "lucide", icon: Network }
    },
    {
      key: "imageTransfer",
      label: t("settings.networkImageTransfer"),
      icon: { kind: "lucide", icon: ImageUp }
    }
  ];
  const localFilesChildItems: Array<SettingsChildItem<LocalFilesSectionKey>> = [
    {
      key: "environment",
      label: t("settings.localFilesEnvironment"),
      icon: { kind: "lucide", icon: Waypoints }
    },
    {
      key: "models",
      label: t("settings.localFilesModels"),
      icon: { kind: "lucide", icon: Boxes }
    },
    {
      key: "tempFiles",
      label: t("settings.localFilesTempFiles"),
      icon: { kind: "lucide", icon: Trash2 }
    }
  ];
  const activeTitle =
    activeSection === "network"
      ? networkChildItems.find((item) => item.key === activeNetworkSection)?.label ?? t(active.labelKey)
      : activeSection === "localFiles"
        ? localFilesChildItems.find((item) => item.key === activeLocalFilesSection)?.label ?? t(active.labelKey)
        : t(active.labelKey);
  const currentLanguage = i18n.language.startsWith("zh") ? "zh-CN" : "en-US";

  const toggleSettingsSection = (section: SettingsSectionKey) => {
    setExpandedSettingsSections((current) => {
      const next = new Set(current);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  useEffect(() => watchThemePreference(setThemePreferenceState), []);
  useEffect(() => watchUiAnimationPreference(setUiAnimationPreferenceState), []);
  useEffect(() => {
    if (!hasTauriRuntime()) return;

    void invokeCommand<GeminiSettings>("get_gemini_settings")
      .then((settings) => {
        setGeminiSettings(settings);
        setHasLoadedGeminiSettings(true);
      })
      .catch((error) => setGeminiMessage(formatAppError(error)));
  }, []);
  useEffect(() => {
    if (!hasTauriRuntime()) return;

    void invokeCommand<ProxySettings>("get_proxy_settings")
      .then((settings) => {
        setProxySettings(settings);
        setHasLoadedProxySettings(true);
      })
      .catch((error) => setProxyMessage(formatAppError(error)));
  }, []);
  useEffect(() => {
    if (!hasTauriRuntime()) return;

    void invokeCommand<LlmLoaderSettings>("get_llm_loader_settings")
      .then((settings) => {
        setLlmLoaderSettings(settings);
        setHasLoadedLlmLoaderSettings(true);
      })
      .catch((error) => setLlmLoaderMessage(formatAppError(error)));
  }, []);
  useEffect(() => {
    if (!hasTauriRuntime()) return;

    void invokeCommand<RemoteLlmSettings>("get_openai_settings")
      .then((settings) => {
        setOpenAiSettings(settings);
        setHasLoadedOpenAiSettings(true);
      })
      .catch((error) => setOpenAiMessage(formatAppError(error)));
  }, []);
  useEffect(() => {
    if (!hasTauriRuntime()) return;

    void invokeCommand<RemoteLlmSettings>("get_anthropic_settings")
      .then((settings) => {
        setAnthropicSettings(settings);
        setHasLoadedAnthropicSettings(true);
      })
      .catch((error) => setAnthropicMessage(formatAppError(error)));
  }, []);
  useEffect(() => {
    if (!hasTauriRuntime()) return;

    void invokeCommand<RemoteLlmSettings>("get_grok_settings")
      .then((settings) => {
        setGrokSettings(settings);
        setHasLoadedGrokSettings(true);
      })
      .catch((error) => setGrokMessage(formatAppError(error)));
  }, []);
  useEffect(() => {
    if (!hasTauriRuntime()) return;

    void invokeCommand<RemoteLlmSettings>("get_doubao_settings")
      .then((settings) => {
        setDoubaoSettings(settings);
        setHasLoadedDoubaoSettings(true);
      })
      .catch((error) => setDoubaoMessage(formatAppError(error)));
  }, []);
  useEffect(() => {
    if (!hasTauriRuntime()) return;

    void invokeCommand<RemoteLlmSettings>("get_qwen_settings")
      .then((settings) => {
        setQwenSettings(settings);
        setHasLoadedQwenSettings(true);
      })
      .catch((error) => setQwenMessage(formatAppError(error)));
  }, []);
  useEffect(() => {
    if (!hasTauriRuntime()) return;

    void invokeCommand<RemoteLlmSettings>("get_zhipu_settings")
      .then((settings) => {
        setZhipuSettings(settings);
        setHasLoadedZhipuSettings(true);
      })
      .catch((error) => setZhipuMessage(formatAppError(error)));
  }, []);
  useEffect(() => {
    if (!hasTauriRuntime()) return;

    void invokeCommand<PythonEnvSettings>("get_python_env_settings")
      .then((settings) => {
        setPythonEnvSettings(settings);
        setHasLoadedPythonEnvSettings(true);
      })
      .catch((error) => setPythonEnvMessage(formatAppError(error)));
  }, []);
  useEffect(() => {
    if (!hasTauriRuntime()) return;

    void invokeCommand<ModelSettings>("get_model_settings")
      .then((settings) => {
        setModelSettings(settings);
        setHasLoadedModelSettings(true);
      })
      .catch((error) => setModelSettingsMessage(formatAppError(error)));
  }, []);
  useEffect(() => {
    if (!hasTauriRuntime()) return;

    void invokeCommand<ThumbnailSettings>("get_thumbnail_settings")
      .then((settings) => {
        setThumbnailSettings(settings);
        setHasLoadedThumbnailSettings(true);
      })
      .catch((error) => setLocalFilesMessage(formatAppError(error)));
  }, []);
  useEffect(() => {
    if (!hasTauriRuntime() || !hasLoadedGeminiSettings) return;

    const saveTimer = window.setTimeout(() => {
      void invokeCommand<GeminiSettings>("save_gemini_settings", {
        settings: geminiSettings
      }).catch((error) => {
        const message = formatAppError(error);
        setGeminiMessage(t("settings.geminiActionFailed", { message }));
      });
    }, 500);

    return () => window.clearTimeout(saveTimer);
  }, [geminiSettings, hasLoadedGeminiSettings]);
  useEffect(() => {
    if (!hasTauriRuntime() || !hasLoadedProxySettings) return;

    const saveTimer = window.setTimeout(() => {
      void invokeCommand<ProxySettings>("save_proxy_settings", {
        settings: proxySettings
      }).catch((error) => {
        const message = formatAppError(error);
        setProxyMessage(t("settings.proxyActionFailed", { message }));
      });
    }, 500);

    return () => window.clearTimeout(saveTimer);
  }, [proxySettings, hasLoadedProxySettings]);
  useEffect(() => {
    if (!hasTauriRuntime() || !hasLoadedLlmLoaderSettings) return;

    const saveTimer = window.setTimeout(() => {
      void invokeCommand<LlmLoaderSettings>("save_llm_loader_settings", {
        settings: llmLoaderSettings
      })
        .then((savedSettings) => {
          if (JSON.stringify(savedSettings) !== JSON.stringify(llmLoaderSettings)) {
            setLlmLoaderSettings(savedSettings);
          }
        })
        .catch((error) => {
          const message = formatAppError(error);
          setLlmLoaderMessage(t("settings.llmLoaderActionFailed", { message }));
        });
    }, 500);

    return () => window.clearTimeout(saveTimer);
  }, [llmLoaderSettings, hasLoadedLlmLoaderSettings]);
  useEffect(() => {
    if (!hasTauriRuntime() || !hasLoadedOpenAiSettings) return;

    const saveTimer = window.setTimeout(() => {
      void invokeCommand<RemoteLlmSettings>("save_openai_settings", {
        settings: openAiSettings
      }).catch((error) => {
        const message = formatAppError(error);
        setOpenAiMessage(t("settings.llmActionFailed", { message }));
      });
    }, 500);

    return () => window.clearTimeout(saveTimer);
  }, [openAiSettings, hasLoadedOpenAiSettings]);
  useEffect(() => {
    if (!hasTauriRuntime() || !hasLoadedAnthropicSettings) return;

    const saveTimer = window.setTimeout(() => {
      void invokeCommand<RemoteLlmSettings>("save_anthropic_settings", {
        settings: anthropicSettings
      }).catch((error) => {
        const message = formatAppError(error);
        setAnthropicMessage(t("settings.llmActionFailed", { message }));
      });
    }, 500);

    return () => window.clearTimeout(saveTimer);
  }, [anthropicSettings, hasLoadedAnthropicSettings]);
  useEffect(() => {
    if (!hasTauriRuntime() || !hasLoadedGrokSettings) return;

    const saveTimer = window.setTimeout(() => {
      void invokeCommand<RemoteLlmSettings>("save_grok_settings", {
        settings: grokSettings
      }).catch((error) => {
        const message = formatAppError(error);
        setGrokMessage(t("settings.llmActionFailed", { message }));
      });
    }, 500);

    return () => window.clearTimeout(saveTimer);
  }, [grokSettings, hasLoadedGrokSettings]);
  useEffect(() => {
    if (!hasTauriRuntime() || !hasLoadedDoubaoSettings) return;

    const saveTimer = window.setTimeout(() => {
      void invokeCommand<RemoteLlmSettings>("save_doubao_settings", {
        settings: doubaoSettings
      }).catch((error) => {
        const message = formatAppError(error);
        setDoubaoMessage(t("settings.llmActionFailed", { message }));
      });
    }, 500);

    return () => window.clearTimeout(saveTimer);
  }, [doubaoSettings, hasLoadedDoubaoSettings]);
  useEffect(() => {
    if (!hasTauriRuntime() || !hasLoadedQwenSettings) return;

    const saveTimer = window.setTimeout(() => {
      void invokeCommand<RemoteLlmSettings>("save_qwen_settings", {
        settings: qwenSettings
      }).catch((error) => {
        const message = formatAppError(error);
        setQwenMessage(t("settings.llmActionFailed", { message }));
      });
    }, 500);

    return () => window.clearTimeout(saveTimer);
  }, [qwenSettings, hasLoadedQwenSettings]);
  useEffect(() => {
    if (!hasTauriRuntime() || !hasLoadedZhipuSettings) return;

    const saveTimer = window.setTimeout(() => {
      void invokeCommand<RemoteLlmSettings>("save_zhipu_settings", {
        settings: zhipuSettings
      }).catch((error) => {
        const message = formatAppError(error);
        setZhipuMessage(t("settings.llmActionFailed", { message }));
      });
    }, 500);

    return () => window.clearTimeout(saveTimer);
  }, [zhipuSettings, hasLoadedZhipuSettings]);
  useEffect(() => {
    if (!hasTauriRuntime() || !hasLoadedPythonEnvSettings) return;

    const saveTimer = window.setTimeout(() => {
      void invokeCommand<PythonEnvSettings>("save_python_env_settings", {
        settings: pythonEnvSettings
      })
        .catch((error) => {
          const message = formatAppError(error);
          setPythonEnvMessage(t("settings.pythonEnvActionFailed", { message }));
        });
    }, 500);

    return () => window.clearTimeout(saveTimer);
  }, [pythonEnvSettings, hasLoadedPythonEnvSettings]);
  useEffect(() => {
    if (!hasTauriRuntime() || !hasLoadedModelSettings) return;

    const saveTimer = window.setTimeout(() => {
      void invokeCommand<ModelSettings>("save_model_settings", {
        settings: modelSettings
      })
        .then((savedSettings) => {
          if (JSON.stringify(savedSettings) !== JSON.stringify(modelSettings)) {
            setModelSettings(savedSettings);
          }
        })
        .catch((error) => {
          const message = formatAppError(error);
          setModelSettingsMessage(t("settings.modelSettingsActionFailed", { message }));
        });
    }, 500);

    return () => window.clearTimeout(saveTimer);
  }, [modelSettings, hasLoadedModelSettings]);
  useEffect(() => {
    if (!hasTauriRuntime() || !hasLoadedThumbnailSettings) return;

    const saveTimer = window.setTimeout(() => {
      void invokeCommand<ThumbnailSettings>("save_thumbnail_settings", {
        settings: thumbnailSettings
      })
        .then((savedSettings) => {
          if (savedSettings.thumbnailSize !== thumbnailSettings.thumbnailSize) {
            setThumbnailSettings(savedSettings);
          }
        })
        .catch((error) => {
          const message = formatAppError(error);
          setLocalFilesMessage(t("settings.tempFilesActionFailed", { message }));
        });
    }, 500);

    return () => window.clearTimeout(saveTimer);
  }, [thumbnailSettings, hasLoadedThumbnailSettings]);
  useEffect(
    () =>
      watchUiOpacity(() => {
        setBottomUiOpacityState(getBottomUiOpacity());
        setTopUiOpacityState(getTopUiOpacity());
      }),
    []
  );

  const updateThemePreference = (preference: ThemePreference) => {
    setThemePreferenceState(preference);
    setThemePreference(preference);
  };

  const updateUiAnimationPreference = (preference: UiAnimationPreference) => {
    setUiAnimationPreferenceState(preference);
    setUiAnimationPreference(preference);
  };

  const updateBottomUiOpacity = (value: number) => {
    setBottomUiOpacityState(value);
    setBottomUiOpacity(value);
  };

  const updateTopUiOpacity = (value: number) => {
    setTopUiOpacityState(value);
    setTopUiOpacity(value);
  };

  const patchGeminiSettings = (patch: Partial<GeminiSettings>) => {
    setGeminiSettings((current) => ({ ...current, ...patch }));
  };

  const patchProxySettings = (patch: Partial<ProxySettings>) => {
    setProxySettings((current) => ({ ...current, ...patch }));
    setProxyMessage("");
  };

  const patchLlmLoaderEndpoint = (
    key: keyof LlmLoaderSettings,
    patch: Partial<LlmLoaderEndpointSettings>
  ) => {
    setLlmLoaderSettings((current) => ({
      ...current,
      [key]: {
        ...current[key],
        ...patch
      }
    }));
    setLlmLoaderMessage("");
  };

  const patchOpenAiSettings = (patch: Partial<RemoteLlmSettings>) => {
    setOpenAiSettings((current) => ({ ...current, ...patch }));
  };

  const patchAnthropicSettings = (patch: Partial<RemoteLlmSettings>) => {
    setAnthropicSettings((current) => ({ ...current, ...patch }));
  };

  const patchGrokSettings = (patch: Partial<RemoteLlmSettings>) => {
    setGrokSettings((current) => ({ ...current, ...patch }));
  };

  const patchDoubaoSettings = (patch: Partial<RemoteLlmSettings>) => {
    setDoubaoSettings((current) => ({ ...current, ...patch }));
  };

  const patchQwenSettings = (patch: Partial<RemoteLlmSettings>) => {
    setQwenSettings((current) => ({ ...current, ...patch }));
  };

  const patchZhipuSettings = (patch: Partial<RemoteLlmSettings>) => {
    setZhipuSettings((current) => ({ ...current, ...patch }));
  };

  const patchPythonEnvSettings = (patch: Partial<PythonEnvSettings>) => {
    setPythonEnvSettings((current) => ({ ...current, ...patch }));
    setPythonEnvProbe(undefined);
  };

  const patchWd14TaggerSettings = (patch: Partial<Wd14TaggerSettings>) => {
    setModelSettings((current) => ({
      ...current,
      wd14Tagger: {
        ...current.wd14Tagger,
        ...patch
      }
    }));
    setModelSettingsMessage("");
  };

  const patchClipSimilaritySettings = (patch: Partial<ClipSimilaritySettings>) => {
    setModelSettings((current) => ({
      ...current,
      clipSimilarity: {
        ...current.clipSimilarity,
        ...patch
      }
    }));
    setModelSettingsMessage("");
  };

  const runGeminiAction = async (action: "fetch" | "test") => {
    if (!hasTauriRuntime() || isGeminiBusy) return;

    setIsGeminiBusy(true);
    setGeminiMessage("");
    try {
      if (action === "fetch") {
        const models = await invokeCommand<string[]>("fetch_gemini_models", {
          settings: geminiSettings
        });
        const nextSettings = {
          ...geminiSettings,
          availableModels: models,
          model: models[0] ?? geminiSettings.model
        };
        setGeminiSettings(nextSettings);
        setGeminiMessage(t("settings.geminiModelsFetched", { count: models.length }));
        return;
      }

      const count = await invokeCommand<number>("test_gemini_connection", {
        settings: geminiSettings
      });
      setGeminiMessage(t("settings.geminiConnectionOk", { count }));
    } catch (error) {
      const message = formatAppError(error);
      setGeminiMessage(t("settings.geminiActionFailed", { message }));
    } finally {
      setIsGeminiBusy(false);
    }
  };

  const runRemoteLlmAction = async (
    provider: RemoteLlmProvider,
    action: "fetch" | "test"
  ) => {
    const runtime = (() => {
      switch (provider) {
        case "openai":
          return {
            isBusy: isOpenAiBusy,
            settings: openAiSettings,
            setBusy: setIsOpenAiBusy,
            setMessage: setOpenAiMessage,
            setSettings: setOpenAiSettings,
            commandPrefix: "openai"
          };
        case "anthropic":
          return {
            isBusy: isAnthropicBusy,
            settings: anthropicSettings,
            setBusy: setIsAnthropicBusy,
            setMessage: setAnthropicMessage,
            setSettings: setAnthropicSettings,
            commandPrefix: "anthropic"
          };
        case "grok":
          return {
            isBusy: isGrokBusy,
            settings: grokSettings,
            setBusy: setIsGrokBusy,
            setMessage: setGrokMessage,
            setSettings: setGrokSettings,
            commandPrefix: "grok"
          };
        case "doubao":
          return {
            isBusy: isDoubaoBusy,
            settings: doubaoSettings,
            setBusy: setIsDoubaoBusy,
            setMessage: setDoubaoMessage,
            setSettings: setDoubaoSettings,
            commandPrefix: "doubao"
          };
        case "qwen":
          return {
            isBusy: isQwenBusy,
            settings: qwenSettings,
            setBusy: setIsQwenBusy,
            setMessage: setQwenMessage,
            setSettings: setQwenSettings,
            commandPrefix: "qwen"
          };
        case "zhipu":
          return {
            isBusy: isZhipuBusy,
            settings: zhipuSettings,
            setBusy: setIsZhipuBusy,
            setMessage: setZhipuMessage,
            setSettings: setZhipuSettings,
            commandPrefix: "zhipu"
          };
      }
    })();
    const { isBusy, settings, setBusy, setMessage, setSettings, commandPrefix } = runtime;
    if (!hasTauriRuntime() || isBusy) return;

    setBusy(true);
    setMessage("");
    try {
      if (action === "fetch") {
        const models = await invokeCommand<string[]>(`fetch_${commandPrefix}_models`, {
          settings
        });
        const nextSettings = {
          ...settings,
          availableModels: models,
          model: models[0] ?? settings.model
        };
        setSettings(nextSettings);
        setMessage(t("settings.llmModelsFetched", { count: models.length }));
        return;
      }

      const count = await invokeCommand<number>(`test_${commandPrefix}_connection`, {
        settings
      });
      setMessage(t("settings.llmConnectionOk", { count }));
    } catch (error) {
      const message = formatAppError(error);
      setMessage(t("settings.llmActionFailed", { message }));
    } finally {
      setBusy(false);
    }
  };

  const renderLlmLoaderSettings = () => {
    const entries: Array<keyof LlmLoaderSettings> = ["lmStudio", "textgen", "ollama"];

    return (
      <div className="rounded-lg border border-neutral-200 bg-white">
        <div className="border-b border-neutral-100 px-4 py-3">
          <div className="text-[13px] font-semibold text-neutral-900">
            {t("settings.llmLoaderTitle")}
          </div>
          <div className="mt-0.5 text-[12px] text-neutral-500">
            {t("settings.llmLoaderDescription")}
          </div>
        </div>

        <div>
          {entries.map((key) => {
            const defaults = llmLoaderDefaults[key];
            const settings = llmLoaderSettings[key];
            return (
              <div
                key={key}
                className="grid gap-3 border-b border-neutral-100 px-4 py-3 last:border-b-0 md:grid-cols-[130px_minmax(0,1fr)]"
              >
                <div className="min-w-0 self-center">
                  <div className="text-[13px] font-medium text-neutral-900">
                    {defaults.label}
                  </div>
                  <div className="mt-0.5 text-[11px] text-neutral-500">
                    {t("settings.llmLoaderDefaultPort", { port: defaults.port })}
                  </div>
                </div>
                <label className="block min-w-0">
                  <span className="mb-1 block text-[12px] font-medium text-neutral-600">
                    {t("settings.llmLoaderBaseUrl")}
                  </span>
                  <input
                    className="glass-input h-8 w-full px-2.5 text-[13px]"
                    value={settings.baseUrl}
                    placeholder={`http://127.0.0.1:${defaults.port}`}
                    onChange={(event) =>
                      patchLlmLoaderEndpoint(key, { baseUrl: event.target.value })
                    }
                  />
                </label>
              </div>
            );
          })}
        </div>

        {llmLoaderMessage ? (
          <div className="border-t border-neutral-100 px-4 py-3 text-[12px] text-neutral-500">
            {llmLoaderMessage}
          </div>
        ) : null}
      </div>
    );
  };

  const renderRemoteRequestScheduling = (
    settings: Pick<GeminiSettings, "targetRpm" | "requestMode">,
    patchSettings: (patch: Partial<Pick<GeminiSettings, "targetRpm" | "requestMode">>) => void
  ) => (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
      <label className="block min-w-0">
        <span className="mb-1 block text-[12px] font-medium text-neutral-600">
          {t("settings.targetRpm")}
        </span>
        <input
          type="number"
          min={0}
          className="glass-input h-8 w-full px-2.5 text-[13px]"
          value={settings.targetRpm}
          onChange={(event) =>
            patchSettings({
              targetRpm: Math.max(0, Number(event.target.value) || 0)
            })
          }
        />
        <span className="mt-1 block text-[11px] text-neutral-500">
          {t("settings.targetRpmDescription")}
        </span>
      </label>

      <div className="min-w-0">
        <div className="mb-1 text-[12px] font-medium text-neutral-600">
          {t("settings.requestMode")}
        </div>
        <div className="grid h-8 grid-cols-2 rounded-md border border-neutral-200 bg-white p-0.5">
          {requestModeOptions.map((option) => {
            const isActive = settings.requestMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                className={`no-drag rounded-[4px] px-2 text-[12px] font-medium transition ${
                  isActive
                    ? "bg-neutral-900 text-white"
                    : "text-neutral-600 hover:bg-neutral-100"
                }`}
                onClick={() => patchSettings({ requestMode: option.value })}
              >
                {t(option.labelKey)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  const renderRemoteLlmSettings = (
    provider: RemoteLlmProvider,
    settings: RemoteLlmSettings,
    patchSettings: (patch: Partial<RemoteLlmSettings>) => void,
    message: string,
    isBusy: boolean
  ) => {
    const metadata = remoteLlmProviderMetadata[provider];
    return (
      <div className="rounded-lg border border-neutral-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-neutral-900">
              {t(metadata.titleKey)}
            </div>
            <div className="mt-0.5 text-[12px] text-neutral-500">
              {t(metadata.descriptionKey)}
            </div>
          </div>
          <button
            type="button"
            className="no-drag h-8 shrink-0 rounded-md border border-neutral-200 bg-white px-3 text-[13px] text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isBusy}
            onClick={() => void runRemoteLlmAction(provider, "test")}
          >
            {t("settings.geminiTestConnection")}
          </button>
        </div>

        <div className="space-y-3 px-4 py-3">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-neutral-600">
              {t("settings.llmBaseUrl")}
            </span>
            <input
              className="glass-input h-8 w-full px-2.5 text-[13px]"
              value={settings.baseUrl}
              placeholder={metadata.baseUrlPlaceholder}
              onChange={(event) => patchSettings({ baseUrl: event.target.value })}
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-neutral-600">
              {t("settings.geminiApiKey")}
            </span>
            <input
              type="password"
              className="glass-input h-8 w-full px-2.5 text-[13px]"
              value={settings.apiKey}
              placeholder={t(metadata.apiKeyPlaceholderKey)}
              onChange={(event) => patchSettings({ apiKey: event.target.value })}
            />
          </label>

          <div className="grid grid-cols-[minmax(0,1fr)_110px] items-end gap-2">
            <label className="block min-w-0">
              <span className="mb-1 block text-[12px] font-medium text-neutral-600">
                {t("settings.geminiModel")}
              </span>
              <EditableModelSelect
                value={settings.model}
                options={settings.availableModels}
                onChange={(model) => patchSettings({ model })}
              />
            </label>
            <button
              type="button"
              className="no-drag h-8 rounded-md border border-neutral-200 bg-white px-2 text-[12px] text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isBusy}
              onClick={() => void runRemoteLlmAction(provider, "fetch")}
            >
              {t("settings.geminiFetchModels")}
            </button>
          </div>

          {renderRemoteRequestScheduling(settings, patchSettings)}

          {message ? (
            <div className="truncate text-[12px] text-neutral-500">
              {message}
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const pickPythonEnvPath = async () => {
    if (!hasTauriRuntime() || isPythonEnvBusy) return;

    setIsPythonEnvBusy(true);
    setPythonEnvMessage("");
    try {
      const path = await invokeCommand<string>("pick_python_env_path");
      patchPythonEnvSettings({ mode: "externalVenv", externalPath: path });
      setPythonEnvMessage(t("settings.pythonEnvPathSelected"));
    } catch (error) {
      const payload = error as { code?: string; message?: string };
      if (payload.code !== "dialog_cancelled") {
        const message = formatAppError(error);
        setPythonEnvMessage(t("settings.pythonEnvActionFailed", { message }));
      }
    } finally {
      setIsPythonEnvBusy(false);
    }
  };

  const inferWd14ModelType = (path: string): Wd14TaggerSettings["modelType"] => {
    const extension = path.split(".").pop()?.toLowerCase();
    if (extension === "onnx") return "onnx";
    if (["pt", "pth", "safetensors", "bin"].includes(extension ?? "")) return "pytorch";
    return "unknown";
  };

  const updateWd14ModelPath = (path: string) => {
    patchWd14TaggerSettings({
      modelPath: path,
      modelType: inferWd14ModelType(path)
    });
  };

  const pickWd14ModelPath = async () => {
    if (!hasTauriRuntime() || isModelSettingsBusy) return;

    setIsModelSettingsBusy(true);
    setModelSettingsMessage("");
    try {
      const selection = await invokeCommand<ModelPathSelection>("pick_wd14_model_path");
      patchWd14TaggerSettings({
        modelPath: selection.path,
        modelType: selection.modelType
      });
      setModelSettingsMessage(t("settings.modelPathSelected"));
    } catch (error) {
      const payload = error as { code?: string; message?: string };
      if (payload.code !== "dialog_cancelled") {
        const message = formatAppError(error);
        setModelSettingsMessage(t("settings.modelSettingsActionFailed", { message }));
      }
    } finally {
      setIsModelSettingsBusy(false);
    }
  };

  const pickClipModelPath = async () => {
    if (!hasTauriRuntime() || isModelSettingsBusy) return;

    setIsModelSettingsBusy(true);
    setModelSettingsMessage("");
    try {
      const selection = await invokeCommand<ModelPathSelection>("pick_wd14_model_path");
      patchClipSimilaritySettings({ modelPath: selection.path });
      setModelSettingsMessage(t("settings.modelPathSelected"));
    } catch (error) {
      const payload = error as { code?: string; message?: string };
      if (payload.code !== "dialog_cancelled") {
        const message = formatAppError(error);
        setModelSettingsMessage(t("settings.modelSettingsActionFailed", { message }));
      }
    } finally {
      setIsModelSettingsBusy(false);
    }
  };

  const probePythonEnv = async (settings = pythonEnvSettings) => {
    if (!hasTauriRuntime() || isPythonEnvBusy) return;

    setIsPythonEnvBusy(true);
    setPythonEnvMessage("");
    try {
      const report = await invokeCommand<PythonEnvProbeReport>("probe_python_env", {
        settings
      });
      setPythonEnvProbe(report);
      setPythonEnvMessage(
        report.ok
          ? t("settings.pythonEnvProbeOk")
          : t("settings.pythonEnvProbeFailed", {
              message: report.error ?? t("settings.pythonEnvUnknownError")
            })
      );
    } catch (error) {
      const message = formatAppError(error);
      setPythonEnvMessage(t("settings.pythonEnvActionFailed", { message }));
    } finally {
      setIsPythonEnvBusy(false);
    }
  };

  const installManagedPythonDeps = async () => {
    if (!hasTauriRuntime() || isPythonEnvBusy) return;

    const confirmed = window.confirm(t("settings.pythonDepsInstallConfirm"));
    if (!confirmed) return;

    const nextSettings: PythonEnvSettings = {
      ...pythonEnvSettings,
      mode: "managedVenv"
    };
    setPythonEnvSettings(nextSettings);
    setPythonEnvProbe(undefined);
    setIsPythonEnvBusy(true);
    setPythonEnvMessage(t("settings.pythonEnvInstalling"));
    try {
      const installResult = await invokeCommand<PythonEnvInstallResult>(
        "install_managed_python_deps",
        {
          installProfile: nextSettings.installProfile
        }
      );
      setPythonEnvMessage(installResult.message);
      if (installResult.success) {
        setPythonEnvSettings((current) => ({
          ...current,
          mode: "managedVenv",
          managedPath: installResult.managedPath
        }));
        await probePythonEnv({
          ...nextSettings,
          managedPath: installResult.managedPath
        });
      }
    } catch (error) {
      const message = formatAppError(error);
      setPythonEnvMessage(t("settings.pythonEnvActionFailed", { message }));
    } finally {
      setIsPythonEnvBusy(false);
    }
  };

  const installManagedOnnxDeps = async () => {
    if (!hasTauriRuntime() || isPythonEnvBusy) return;

    const confirmed = window.confirm(t("settings.onnxDepsInstallConfirm"));
    if (!confirmed) return;

    const nextSettings: PythonEnvSettings = {
      ...pythonEnvSettings,
      mode: "managedVenv"
    };
    setPythonEnvSettings(nextSettings);
    setPythonEnvProbe(undefined);
    setIsPythonEnvBusy(true);
    setPythonEnvMessage(t("settings.onnxRuntimeInstalling"));
    try {
      const installResult = await invokeCommand<PythonEnvInstallResult>(
        "install_managed_onnx_deps",
        {
          installProfile: nextSettings.onnxInstallProfile
        }
      );
      setPythonEnvMessage(installResult.message);
      if (installResult.success) {
        setPythonEnvSettings((current) => ({
          ...current,
          mode: "managedVenv",
          managedPath: installResult.managedPath
        }));
        await probePythonEnv({
          ...nextSettings,
          managedPath: installResult.managedPath
        });
      }
    } catch (error) {
      const message = formatAppError(error);
      setPythonEnvMessage(t("settings.pythonEnvActionFailed", { message }));
    } finally {
      setIsPythonEnvBusy(false);
    }
  };

  const refreshTemporaryFilesInfo = async () => {
    if (!hasTauriRuntime() || isTemporaryFilesBusy) return;

    setIsTemporaryFilesBusy(true);
    setLocalFilesMessage("");
    try {
      const [thumbnailInfo, logInfo] = await Promise.all([
        invokeCommand<ThumbnailCacheInfo>("get_thumbnail_cache_info"),
        invokeCommand<LogFilesInfo>("get_log_files_info")
      ]);
      setThumbnailCacheInfo(thumbnailInfo);
      setLogFilesInfo(logInfo);
    } catch (error) {
      const message = formatAppError(error);
      setLocalFilesMessage(t("settings.tempFilesActionFailed", { message }));
    } finally {
      setIsTemporaryFilesBusy(false);
    }
  };

  const clearThumbnailCache = async () => {
    if (!hasTauriRuntime() || isTemporaryFilesBusy) return;

    setIsTemporaryFilesBusy(true);
    setLocalFilesMessage("");
    try {
      const info = await invokeCommand<ThumbnailCacheInfo>("clear_thumbnail_cache");
      setThumbnailCacheInfo(info);
      await refreshImages();
      bumpThumbnailCacheKey();
      const refreshedInfo = await invokeCommand<ThumbnailCacheInfo>("get_thumbnail_cache_info");
      setThumbnailCacheInfo(refreshedInfo);
      setLocalFilesMessage(t("settings.thumbnailCacheCleared"));
    } catch (error) {
      const message = formatAppError(error);
      setLocalFilesMessage(t("settings.tempFilesActionFailed", { message }));
    } finally {
      setIsTemporaryFilesBusy(false);
    }
  };

  const clearLogFiles = async () => {
    if (!hasTauriRuntime() || isTemporaryFilesBusy) return;

    setIsTemporaryFilesBusy(true);
    setLocalFilesMessage("");
    try {
      const info = await invokeCommand<LogFilesInfo>("clear_log_files");
      setLogFilesInfo(info);
      setLocalFilesMessage(t("settings.logFilesCleared"));
    } catch (error) {
      const message = formatAppError(error);
      setLocalFilesMessage(t("settings.tempFilesActionFailed", { message }));
    } finally {
      setIsTemporaryFilesBusy(false);
    }
  };

  useEffect(() => {
    if (activeSection === "localFiles" && activeLocalFilesSection === "tempFiles") {
      void refreshTemporaryFilesInfo();
    }
  }, [activeSection, activeLocalFilesSection]);

  const torchDeviceSummary = pythonEnvProbe
    ? pythonEnvProbe.cudaAvailable
      ? [
          t("settings.pythonEnvCudaAvailable", {
            version: pythonEnvProbe.cudaVersion ?? "-"
          }),
          pythonEnvProbe.deviceNames.length > 0
            ? pythonEnvProbe.deviceNames.join(", ")
            : undefined
        ]
          .filter(Boolean)
          .join(" / ")
      : t("settings.pythonEnvCudaUnavailable")
    : "-";
  const onnxProviderSummary = pythonEnvProbe?.onnxRuntimeProviders.length
    ? pythonEnvProbe.onnxRuntimeProviders.join(", ")
    : "-";

  return (
    <AnimatedPortal open={open}>
    <div
      className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/18 px-5"
    >
      <section
        className="flex h-[560px] w-full max-w-[820px] overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_24px_72px_rgba(23,23,23,0.22)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <aside className="flex w-[220px] shrink-0 flex-col border-r border-neutral-200 bg-neutral-50/90">
          <div className="flex h-14 items-center gap-2 border-b border-neutral-200 px-4">
            <Globe2 size={17} className="text-neutral-700" />
            <h2 id="settings-title" className="m-0 text-[15px] font-semibold text-neutral-950">
              {t("settings.title")}
            </h2>
          </div>

          <nav
            className="hover-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-3"
            aria-label={t("settings.categoryLabel")}
          >
            <div className="space-y-1">
              {sections.map((section) => {
                const Icon = section.icon;
                const isActive = section.key === activeSection;
                const hasChildren = section.key === "network" || section.key === "localFiles";
                const isExpanded = expandedSettingsSections.has(section.key);
                const childItems =
                  section.key === "network"
                    ? networkChildItems
                    : section.key === "localFiles"
                      ? localFilesChildItems
                      : [];

                return (
                  <div key={section.key}>
                    <div
                      className={cn(
                        "sidebar-nav-button flex h-9 w-full items-center gap-1 rounded px-1.5 text-left text-[13px] transition",
                        isActive && "sidebar-nav-button-active"
                      )}
                    >
                      {hasChildren ? (
                        <HierarchyDisclosureButton
                          expanded={isExpanded}
                          aria-label={isExpanded ? t("tree.collapse") : t("tree.expand")}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleSettingsSection(section.key);
                          }}
                        />
                      ) : (
                        <span className="w-6 shrink-0" aria-hidden />
                      )}
                      <button
                        type="button"
                        className="no-drag flex h-full min-w-0 flex-1 items-center gap-2 rounded border-0 bg-transparent px-1.5 text-left text-inherit outline-none focus-visible:ring-2 focus-visible:ring-black/20"
                        aria-current={isActive && !hasChildren ? "page" : undefined}
                        onClick={() => {
                          setActiveSection(section.key);
                          if (hasChildren && !isExpanded) {
                            toggleSettingsSection(section.key);
                          }
                        }}
                      >
                        <Icon size={16} className="shrink-0" />
                        <span className="truncate">{t(section.labelKey)}</span>
                      </button>
                    </div>
                    {hasChildren ? (
                      <div
                        className={cn(
                          "project-tree-children",
                          isExpanded && "project-tree-children-open"
                        )}
                        aria-hidden={!isExpanded}
                        inert={!isExpanded}
                      >
                        <div className="min-h-0 overflow-hidden">
                          <div className="ml-8 space-y-1 py-1 pl-3 pr-1">
                            {childItems.map((item) => {
                              const childActive =
                                section.key === "network"
                                  ? activeSection === "network" && item.key === activeNetworkSection
                                  : activeSection === "localFiles" && item.key === activeLocalFilesSection;
                              return (
                                <button
                                  key={item.key}
                                  type="button"
                                  className={cn(
                                    "sidebar-nav-button flex h-8 w-full items-center gap-2 rounded px-3 text-left text-[12px] transition",
                                    childActive && "sidebar-nav-button-active"
                                  )}
                                  aria-current={childActive ? "page" : undefined}
                                  onClick={() => {
                                    setActiveSection(section.key);
                                    if (section.key === "network") {
                                      setActiveNetworkSection(item.key as NetworkSectionKey);
                                    } else {
                                      setActiveLocalFilesSection(item.key as LocalFilesSectionKey);
                                    }
                                  }}
                                >
                                  <SettingsTreeIcon icon={item.icon} />
                                  <span className="truncate">{item.label}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col bg-white">
          <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 px-5">
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-neutral-950">
                {activeTitle}
              </div>
            </div>
            <Button
              type="button"
              variant="icon"
              className="shrink-0"
              aria-label={t("settings.close")}
              title={t("menu.close")}
              onClick={close}
            >
              <X className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden="true" />
            </Button>
          </header>

          <div
            className="hover-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-neutral-50/42 p-5"
          >
            {activeSection === "general" ? (
              <div className="rounded-lg border border-neutral-200 bg-white">
                <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-neutral-900">
                      {t("settings.highlightCellState")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-neutral-500">
                      {t("settings.highlightCellStateDescription")}
                    </div>
                  </div>
                  <Switch
                    aria-label={t("settings.highlightCellState")}
                    checked={highlightCellState}
                    onCheckedChange={setHighlightCellState}
                  />
                  </div>
                  <div className="flex min-h-12 items-center justify-between gap-4 border-t border-neutral-100 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-neutral-900">
                        {t("settings.autoSaveAfterAnnotation")}
                      </div>
                      <div className="mt-0.5 text-[12px] text-neutral-500">
                        {t("settings.autoSaveAfterAnnotationDescription")}
                      </div>
                    </div>
                    <Switch
                      aria-label={t("settings.autoSaveAfterAnnotation")}
                      checked={autoSaveAfterAnnotation}
                      onCheckedChange={setAutoSaveAfterAnnotation}
                    />
                  </div>
                  <div className="flex min-h-12 items-center justify-between gap-4 border-t border-neutral-100 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-neutral-900">
                        {t("settings.autoSaveAfterBatch")}
                      </div>
                      <div className="mt-0.5 text-[12px] text-neutral-500">
                        {t("settings.autoSaveAfterBatchDescription")}
                      </div>
                    </div>
                    <Switch
                      aria-label={t("settings.autoSaveAfterBatch")}
                      checked={autoSaveAfterBatch}
                      onCheckedChange={setAutoSaveAfterBatch}
                    />
                  </div>
                </div>
              ) : activeSection === "language" ? (
              <div className="rounded-lg border border-neutral-200 bg-white">
                <div className="flex min-h-12 items-center justify-between gap-4 border-b border-neutral-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-neutral-900">
                      {t("settings.languageNative")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-neutral-500">
                      {t("settings.languageDescription")}
                    </div>
                  </div>
                  <AppSelect
                    className="min-w-[150px]"
                    value={currentLanguage}
                    options={languageOptions.map((option) => ({
                      value: option.value,
                      label: t(option.labelKey)
                    }))}
                    onChange={(nextValue) => void i18next.changeLanguage(nextValue)}
                  />
                </div>
              </div>
            ) : activeSection === "localFiles" ? (
              <div className="space-y-3">
                {activeLocalFilesSection === "environment" ? (
                  <div className="rounded-lg border border-neutral-200 bg-white">
                    <div className="flex h-11 items-center justify-between gap-3 border-b border-neutral-200 px-3">
                      <div className="min-w-0 text-[13px] font-semibold text-neutral-900">
                        {t("settings.pythonEnvTitle")}
                      </div>
                      <button
                        type="button"
                        className="no-drag h-7 shrink-0 rounded-md border border-neutral-300 bg-white px-2.5 text-[12px] text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={isPythonEnvBusy}
                        onClick={() => void probePythonEnv()}
                      >
                        {t("settings.pythonEnvProbe")}
                      </button>
                    </div>

                    <div className="py-1">
                      <div className="grid min-h-11 grid-cols-[132px_minmax(0,1fr)] items-center gap-3 px-3 py-2">
                        <div className="text-[12px] text-neutral-500">
                          {t("settings.pythonEnvMode")}
                        </div>
                        <AppSelect
                          value={pythonEnvSettings.mode}
                          options={pythonEnvModeOptions.map((option) => ({
                            value: option.value,
                            label: t(option.labelKey)
                          }))}
                          onChange={(nextValue) =>
                            patchPythonEnvSettings({ mode: nextValue as PythonEnvMode })
                          }
                        />
                      </div>

                      <div className="grid min-h-11 grid-cols-[132px_minmax(0,1fr)] items-center gap-3 px-3 py-2">
                        <div className="text-[12px] text-neutral-500">
                          {pythonEnvSettings.mode === "externalVenv"
                            ? t("settings.pythonEnvExternal")
                            : t("settings.runtimeManagedSource")}
                        </div>
                        {pythonEnvSettings.mode === "externalVenv" ? (
                          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_104px] gap-2">
                            <input
                              className="glass-input h-8 min-w-0 px-2.5 text-[13px]"
                              value={pythonEnvSettings.externalPath}
                              placeholder={t("settings.pythonEnvExternalPlaceholder")}
                              onChange={(event) =>
                                patchPythonEnvSettings({
                                  mode: "externalVenv",
                                  externalPath: event.target.value
                                })
                              }
                            />
                            <button
                              type="button"
                              className="no-drag h-8 rounded-md border border-neutral-300 bg-white px-2 text-[12px] text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={isPythonEnvBusy}
                              onClick={() => void pickPythonEnvPath()}
                            >
                              {t("settings.pythonEnvPickFolder")}
                            </button>
                          </div>
                        ) : (
                          <div
                            className="min-w-0 truncate text-[12px] text-neutral-700"
                            title={
                              pythonEnvSettings.managedPath ||
                              t("settings.runtimeManagedPathPending")
                            }
                          >
                            {pythonEnvSettings.managedPath || t("settings.runtimeManagedPathPending")}
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="grid grid-cols-[112px_92px_120px_minmax(0,1fr)] border-b border-black/[0.06] px-3 py-2 text-[11px] font-semibold uppercase text-neutral-500">
                        <div>{t("settings.pythonEnvProbeResult")}</div>
                        <div>{t("settings.pythonEnvStatus")}</div>
                        <div>{t("settings.pythonEnvPythonVersion")}</div>
                        <div>{t("settings.pythonEnvDevices")}</div>
                      </div>

                      <div className="grid min-h-10 grid-cols-[112px_92px_120px_minmax(0,1fr)] items-center border-b border-black/[0.06] px-3 py-2 text-[12px]">
                        <div className="font-medium text-neutral-900">
                          {t("settings.pytorchRuntime")}
                        </div>
                        <div
                          className={cn(
                            "font-medium",
                            pythonEnvProbe?.torchAvailable
                              ? "text-emerald-700"
                              : pythonEnvProbe
                                ? "text-amber-700"
                                : "text-neutral-500"
                          )}
                        >
                          {pythonEnvProbe
                            ? pythonEnvProbe.torchAvailable
                              ? t("settings.runtimeAvailable")
                              : t("settings.runtimeUnavailable")
                            : t("settings.runtimeNotChecked")}
                        </div>
                        <div className="min-w-0 truncate text-neutral-700">
                          {pythonEnvProbe?.torchVersion ?? "-"}
                        </div>
                        <div
                          className="min-w-0 truncate text-neutral-700"
                          title={torchDeviceSummary}
                        >
                          {torchDeviceSummary}
                        </div>
                      </div>

                      <div className="grid min-h-10 grid-cols-[112px_92px_120px_minmax(0,1fr)] items-center px-3 py-2 text-[12px]">
                        <div className="font-medium text-neutral-900">
                          {t("settings.onnxRuntime")}
                        </div>
                        <div
                          className={cn(
                            "font-medium",
                            pythonEnvProbe?.onnxRuntimeAvailable
                              ? "text-emerald-700"
                              : pythonEnvProbe
                                ? "text-amber-700"
                                : "text-neutral-500"
                          )}
                        >
                          {pythonEnvProbe
                            ? pythonEnvProbe.onnxRuntimeAvailable
                              ? t("settings.runtimeAvailable")
                              : t("settings.runtimeUnavailable")
                            : t("settings.runtimeNotChecked")}
                        </div>
                        <div className="min-w-0 truncate text-neutral-700">
                          {pythonEnvProbe?.onnxRuntimeVersion ?? "-"}
                        </div>
                        <div
                          className="min-w-0 truncate text-neutral-700"
                          title={onnxProviderSummary}
                        >
                          {onnxProviderSummary}
                        </div>
                      </div>
                    </div>

                    {pythonEnvSettings.mode === "managedVenv" ? (
                      <div className="pt-2 pb-1">
                        <div className="grid grid-cols-[112px_minmax(0,180px)_96px] items-center gap-2 border-b border-black/[0.06] px-3 py-2">
                          <div className="text-[12px] font-medium text-neutral-900">
                            {t("settings.pytorchRuntime")}
                          </div>
                          <AppSelect
                            value={pythonEnvSettings.installProfile}
                            options={pythonInstallProfileOptions.map((option) => ({
                              value: option.value,
                              label: t(option.labelKey)
                            }))}
                            onChange={(nextValue) =>
                              patchPythonEnvSettings({
                                installProfile: nextValue as PythonEnvInstallProfile
                              })
                            }
                          />
                          <button
                            type="button"
                            className="no-drag h-8 rounded-md border border-neutral-900 bg-neutral-900 px-2 text-[11px] font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={isPythonEnvBusy}
                            onClick={() => void installManagedPythonDeps()}
                          >
                            {t("settings.runtimeInstall")}
                          </button>
                        </div>
                        <div className="grid grid-cols-[112px_minmax(0,180px)_96px] items-center gap-2 px-3 py-2">
                          <div className="text-[12px] font-medium text-neutral-900">
                            {t("settings.onnxRuntime")}
                          </div>
                          <AppSelect
                            value={pythonEnvSettings.onnxInstallProfile}
                            options={onnxInstallProfileOptions.map((option) => ({
                              value: option.value,
                              label: t(option.labelKey)
                            }))}
                            onChange={(nextValue) =>
                              patchPythonEnvSettings({
                                onnxInstallProfile: nextValue as OnnxRuntimeInstallProfile
                              })
                            }
                          />
                          <button
                            type="button"
                            className="no-drag h-8 rounded-md border border-neutral-900 bg-neutral-900 px-2 text-[11px] font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={isPythonEnvBusy}
                            onClick={() => void installManagedOnnxDeps()}
                          >
                            {t("settings.runtimeInstall")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="truncate px-3 py-2 text-[12px] text-neutral-500"
                        title={t("settings.runtimeExternalHint")}
                      >
                        {t("settings.runtimeExternalHint")}
                      </div>
                    )}

                    {pythonEnvProbe?.pythonPath || pythonEnvProbe?.pythonVersion ? (
                      <div className="grid grid-cols-[132px_minmax(0,1fr)] gap-3 border-t border-black/[0.06] px-3 py-2 text-[12px]">
                        <div className="text-neutral-500">{t("settings.pythonEnvPythonPath")}</div>
                        <div
                          className="min-w-0 truncate text-neutral-700"
                          title={pythonEnvProbe.pythonPath ?? "-"}
                        >
                          {pythonEnvProbe.pythonPath ?? "-"}
                        </div>
                      </div>
                    ) : null}

                    {pythonEnvProbe?.torchError || pythonEnvProbe?.onnxRuntimeError || pythonEnvProbe?.error ? (
                      <div className="hover-scrollbar max-h-20 space-y-1 overflow-y-auto border-t border-black/[0.06] px-3 py-2 text-[12px] leading-5 text-amber-700">
                        {pythonEnvProbe.error ? <div className="break-words">{pythonEnvProbe.error}</div> : null}
                        {pythonEnvProbe.torchError ? (
                          <div className="break-words">{pythonEnvProbe.torchError}</div>
                        ) : null}
                        {pythonEnvProbe.onnxRuntimeError ? (
                          <div className="break-words">{pythonEnvProbe.onnxRuntimeError}</div>
                        ) : null}
                      </div>
                    ) : null}

                    {pythonEnvMessage ? (
                      <div
                        className="truncate border-t border-black/[0.06] px-3 py-2 text-[12px] text-neutral-500"
                        title={pythonEnvMessage}
                      >
                        {pythonEnvMessage}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {activeLocalFilesSection === "models" ? (
                  <div className="space-y-3">
                    <div className="rounded-lg border border-neutral-200 bg-white">
                      <div className="flex h-11 items-center justify-between gap-3 border-b border-neutral-200 px-3">
                        <div className="min-w-0 text-[13px] font-semibold text-neutral-900">
                          {t("settings.wd14Tagger")}
                        </div>
                        <div className="shrink-0 text-[12px] text-neutral-500">
                          {modelSettings.wd14Tagger.modelPath
                            ? t(`settings.modelType${modelSettings.wd14Tagger.modelType}`)
                            : t("settings.modelTypeUnset")}
                        </div>
                      </div>

                      <div className="divide-y divide-black/[0.06]">
                        <div className="grid min-h-12 grid-cols-[132px_minmax(0,1fr)_104px] items-center gap-2 px-3 py-2">
                          <div className="text-[12px] text-neutral-500">
                            {t("settings.wd14ModelPath")}
                          </div>
                          <input
                            className="glass-input h-8 min-w-0 px-2.5 text-[13px]"
                            value={modelSettings.wd14Tagger.modelPath}
                            placeholder={t("settings.wd14ModelPathPlaceholder")}
                            onChange={(event) => updateWd14ModelPath(event.target.value)}
                          />
                          <button
                            type="button"
                            className="no-drag h-8 rounded-md border border-neutral-300 bg-white px-2 text-[12px] text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={isModelSettingsBusy}
                            onClick={() => void pickWd14ModelPath()}
                          >
                            {t("settings.modelPickFile")}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg border border-neutral-200 bg-white">
                      <div className="flex h-11 items-center justify-between gap-3 border-b border-neutral-200 px-3">
                        <div className="min-w-0 text-[13px] font-semibold text-neutral-900">
                          {t("settings.clipSimilarity")}
                        </div>
                        <div className="shrink-0 text-[12px] text-neutral-500">
                          {modelSettings.clipSimilarity.modelPath
                            ? t("settings.modelTypeFolder")
                            : t("settings.modelTypeUnset")}
                        </div>
                      </div>

                      <div className="divide-y divide-black/[0.06]">
                        <div className="grid min-h-12 grid-cols-[132px_minmax(0,1fr)_104px] items-center gap-2 px-3 py-2">
                          <div className="text-[12px] text-neutral-500">
                            {t("settings.clipModelPath")}
                          </div>
                          <input
                            className="glass-input h-8 min-w-0 px-2.5 text-[13px]"
                            value={modelSettings.clipSimilarity.modelPath}
                            placeholder={t("settings.clipModelPathPlaceholder")}
                            onChange={(event) =>
                              patchClipSimilaritySettings({ modelPath: event.target.value })
                            }
                          />
                          <button
                            type="button"
                            className="no-drag h-8 rounded-md border border-neutral-300 bg-white px-2 text-[12px] text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={isModelSettingsBusy}
                            onClick={() => void pickClipModelPath()}
                          >
                            {t("settings.modelPickFile")}
                          </button>
                        </div>
                      </div>
                    </div>

                    {modelSettingsMessage ? (
                      <div
                        className="truncate rounded-lg border border-neutral-200 bg-white px-3 py-2 text-[12px] text-neutral-500"
                        title={modelSettingsMessage}
                      >
                        {modelSettingsMessage}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {activeLocalFilesSection === "tempFiles" ? (
              <div className="rounded-lg border border-neutral-200 bg-white">
                <div className="flex min-h-12 items-center justify-between gap-4 border-b border-neutral-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-neutral-900">
                      {t("settings.thumbnailSize")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-neutral-500">
                      {t("settings.thumbnailSizeDescription")}
                    </div>
                  </div>
                  <AppSelect
                    className="w-[128px] shrink-0"
                    value={String(thumbnailSettings.thumbnailSize)}
                    options={thumbnailSizeOptions}
                    onChange={(nextValue) =>
                      setThumbnailSettings({ thumbnailSize: Number(nextValue) })
                    }
                  />
                </div>
                <div className="flex min-h-12 items-center justify-between gap-4 border-b border-neutral-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-neutral-900">
                      {t("settings.thumbnailCache")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-neutral-500">
                      {t("settings.thumbnailCacheDescription")}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="min-w-20 text-right text-[13px] font-medium text-neutral-700">
                      {formatBytes(thumbnailCacheInfo.sizeBytes)}
                    </span>
                    <button
                      type="button"
                      className="no-drag h-8 rounded-md border border-neutral-200 bg-white px-3 text-[13px] text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isTemporaryFilesBusy}
                      onClick={() => void refreshTemporaryFilesInfo()}
                    >
                      {t("settings.tempFilesRefresh")}
                    </button>
                    <button
                      type="button"
                      className="no-drag h-8 rounded-md border border-neutral-900 bg-neutral-900 px-3 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isTemporaryFilesBusy || thumbnailCacheInfo.sizeBytes === 0}
                      onClick={() => void clearThumbnailCache()}
                    >
                      {t("settings.tempFilesClear")}
                    </button>
                  </div>
                </div>
                <div className="flex min-h-12 items-center justify-between gap-4 border-b border-neutral-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-neutral-900">
                      {t("settings.logFiles")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-neutral-500">
                      {t("settings.logFilesDescription")}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="min-w-20 text-right text-[13px] font-medium text-neutral-700">
                      {formatBytes(logFilesInfo.sizeBytes)}
                    </span>
                    <button
                      type="button"
                      className="no-drag h-8 rounded-md border border-neutral-900 bg-neutral-900 px-3 text-[13px] font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={isTemporaryFilesBusy || logFilesInfo.sizeBytes === 0}
                      onClick={() => void clearLogFiles()}
                    >
                      {t("settings.tempFilesClear")}
                    </button>
                  </div>
                </div>
                {localFilesMessage ? (
                  <div className="px-4 py-3 text-[12px] text-neutral-500">
                    {localFilesMessage}
                  </div>
                ) : null}
              </div>
                ) : null}
              </div>
            ) : activeSection === "appearance" ? (
              <div className="rounded-lg border border-neutral-200 bg-white">
                <div className="flex min-h-12 items-center justify-between gap-4 border-b border-neutral-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-neutral-900">
                      {t("settings.theme")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-neutral-500">
                      {t("settings.themeDescription")}
                    </div>
                  </div>
                  <AppSelect
                    className="min-w-[150px]"
                    value={themePreference}
                    options={themeOptions.map((option) => ({
                      value: option.value,
                      label: t(option.labelKey)
                    }))}
                    onChange={(nextValue) =>
                      updateThemePreference(nextValue as ThemePreference)
                    }
                  />
                </div>
                <div className="flex min-h-12 items-center justify-between gap-4 border-b border-neutral-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-neutral-900">
                      {t("settings.uiAnimation")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-neutral-500">
                      {t("settings.uiAnimationDescription")}
                    </div>
                  </div>
                  <AppSelect
                    className="min-w-[150px]"
                    value={uiAnimationPreference}
                    options={uiAnimationOptions.map((option) => ({
                      value: option.value,
                      label: t(option.labelKey)
                    }))}
                    onChange={(nextValue) =>
                      updateUiAnimationPreference(nextValue as UiAnimationPreference)
                    }
                  />
                </div>
                <div className="flex min-h-12 items-center justify-between gap-4 border-b border-neutral-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-neutral-900">
                      {t("settings.bottomUiOpacity")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-neutral-500">
                      {t("settings.bottomUiOpacityDescription")}
                    </div>
                  </div>
                  <div className="flex min-w-[210px] items-center gap-3">
                    <Slider
                      min={70}
                      max={100}
                      value={bottomUiOpacity}
                      onChange={(event) => updateBottomUiOpacity(Number(event.target.value))}
                      className="no-drag w-full"
                    />
                    <span className="w-10 text-right text-[12px] text-neutral-500">
                      {bottomUiOpacity}%
                    </span>
                  </div>
                </div>
                <div className="flex min-h-12 items-center justify-between gap-4 border-b border-neutral-100 px-4 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-neutral-900">
                      {t("settings.topUiOpacity")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-neutral-500">
                      {t("settings.topUiOpacityDescription")}
                    </div>
                  </div>
                  <div className="flex min-w-[210px] items-center gap-3">
                    <Slider
                      min={30}
                      max={100}
                      value={topUiOpacity}
                      onChange={(event) => updateTopUiOpacity(Number(event.target.value))}
                      className="no-drag w-full"
                    />
                    <span className="w-10 text-right text-[12px] text-neutral-500">
                      {topUiOpacity}%
                    </span>
                  </div>
                </div>
              </div>
            ) : activeSection === "network" ? (
              <div className="space-y-3">
                {activeNetworkSection === "gemini" ? (
                  <div className="rounded-lg border border-neutral-200 bg-white">
                    <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold text-neutral-900">
                          {t("settings.geminiApi")}
                        </div>
                        <div className="mt-0.5 text-[12px] text-neutral-500">
                          {t("settings.geminiApiDescription")}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="no-drag h-8 shrink-0 rounded-md border border-neutral-200 bg-white px-3 text-[13px] text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={isGeminiBusy}
                        onClick={() => void runGeminiAction("test")}
                      >
                        {t("settings.geminiTestConnection")}
                      </button>
                    </div>

                    <div className="space-y-3 px-4 py-3">
                      <label className="block">
                        <span className="mb-1 block text-[12px] font-medium text-neutral-600">
                          {t("settings.llmBaseUrl")}
                        </span>
                        <input
                          className="glass-input h-8 w-full px-2.5 text-[13px]"
                          value={geminiSettings.baseUrl}
                          placeholder="https://generativelanguage.googleapis.com/v1beta"
                          onChange={(event) => patchGeminiSettings({ baseUrl: event.target.value })}
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-[12px] font-medium text-neutral-600">
                          {t("settings.geminiApiKey")}
                        </span>
                        <input
                          type="password"
                          className="glass-input h-8 w-full px-2.5 text-[13px]"
                          value={geminiSettings.apiKey}
                          placeholder={t("settings.geminiApiKeyPlaceholder")}
                          onChange={(event) => patchGeminiSettings({ apiKey: event.target.value })}
                        />
                      </label>

                      <div className="grid grid-cols-[minmax(0,1fr)_110px] items-end gap-2">
                        <label className="block min-w-0">
                          <span className="mb-1 block text-[12px] font-medium text-neutral-600">
                            {t("settings.geminiModel")}
                          </span>
                          <EditableModelSelect
                            value={geminiSettings.model}
                            options={geminiSettings.availableModels}
                            onChange={(model) => patchGeminiSettings({ model })}
                          />
                        </label>
                        <button
                          type="button"
                          className="no-drag h-8 rounded-md border border-neutral-200 bg-white px-2 text-[12px] text-neutral-700 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={isGeminiBusy}
                          onClick={() => void runGeminiAction("fetch")}
                        >
                          {t("settings.geminiFetchModels")}
                        </button>
                      </div>

                      {renderRemoteRequestScheduling(geminiSettings, patchGeminiSettings)}

                      {geminiMessage ? (
                        <div className="truncate text-[12px] text-neutral-500">
                          {geminiMessage}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {activeNetworkSection === "openai"
                  ? renderRemoteLlmSettings(
                      "openai",
                      openAiSettings,
                      patchOpenAiSettings,
                      openAiMessage,
                      isOpenAiBusy
                    )
                  : null}

                {activeNetworkSection === "anthropic"
                  ? renderRemoteLlmSettings(
                      "anthropic",
                      anthropicSettings,
                      patchAnthropicSettings,
                      anthropicMessage,
                      isAnthropicBusy
                    )
                  : null}

                {activeNetworkSection === "grok"
                  ? renderRemoteLlmSettings(
                      "grok",
                      grokSettings,
                      patchGrokSettings,
                      grokMessage,
                      isGrokBusy
                    )
                  : null}

                {activeNetworkSection === "doubao"
                  ? renderRemoteLlmSettings(
                      "doubao",
                      doubaoSettings,
                      patchDoubaoSettings,
                      doubaoMessage,
                      isDoubaoBusy
                    )
                  : null}

                {activeNetworkSection === "qwen"
                  ? renderRemoteLlmSettings(
                      "qwen",
                      qwenSettings,
                      patchQwenSettings,
                      qwenMessage,
                      isQwenBusy
                    )
                  : null}

                {activeNetworkSection === "zhipu"
                  ? renderRemoteLlmSettings(
                      "zhipu",
                      zhipuSettings,
                      patchZhipuSettings,
                      zhipuMessage,
                      isZhipuBusy
                    )
                  : null}

                {activeNetworkSection === "llmLoader" ? renderLlmLoaderSettings() : null}

                {activeNetworkSection === "proxy" ? (
                  <div className="rounded-lg border border-neutral-200 bg-white">
                  <div className="border-b border-neutral-100 px-4 py-3">
                    <div className="text-[13px] font-semibold text-neutral-900">
                      {t("settings.networkProxy")}
                    </div>
                    <div className="mt-0.5 text-[12px] text-neutral-500">
                      {t("settings.networkProxyDescription")}
                    </div>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_160px] gap-4 px-4 py-3">
                    <Switch
                      className="self-start pt-1"
                      checked={proxySettings.useProxy}
                      label={t("settings.proxyUseProxy")}
                      onCheckedChange={(checked) => patchProxySettings({ useProxy: checked })}
                    />
                    <label className="block">
                      <span className="mb-1 block text-[12px] font-medium text-neutral-600">
                        {t("settings.proxyPort")}
                      </span>
                      <input
                        className="glass-input h-8 w-full px-2.5 text-[13px]"
                        value={proxySettings.proxyPort}
                        disabled={!proxySettings.useProxy}
                        onChange={(event) => patchProxySettings({ proxyPort: event.target.value })}
                      />
                      <span className="mt-1 block text-[11px] text-neutral-500">
                        {t("settings.proxyPortDescription")}
                      </span>
                    </label>
                  </div>
                  {proxyMessage ? (
                    <div className="px-4 pb-3 text-[12px] text-neutral-500">
                      {proxyMessage}
                    </div>
                  ) : null}
                </div>
                ) : null}

                {activeNetworkSection === "imageTransfer" ? (
                  <div className="rounded-lg border border-neutral-200 bg-white">
                    <div className="border-b border-neutral-100 px-4 py-3">
                      <div className="text-[13px] font-semibold text-neutral-900">
                        {t("settings.networkImageTransfer")}
                      </div>
                      <div className="mt-0.5 text-[12px] text-neutral-500">
                        {t("settings.networkImageTransferDescription")}
                      </div>
                    </div>
                    <div>
                      <div className="flex min-h-12 items-center justify-between gap-4 border-b border-neutral-100 px-4 py-3">
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-neutral-900">
                            {t("settings.geminiImageResize")}
                          </div>
                          <div className="mt-0.5 text-[12px] text-neutral-500">
                            {t("settings.geminiImageResizeDescription")}
                          </div>
                        </div>
                        <AppSelect
                          className="w-[180px] shrink-0"
                          value={geminiSettings.imageResizeMode}
                          options={resizeOptions.map((option) => ({
                            value: option.value,
                            label: t(option.labelKey)
                          }))}
                          onChange={(nextValue) =>
                            patchGeminiSettings({ imageResizeMode: nextValue })
                          }
                        />
                      </div>
                      <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-3">
                        <div className="min-w-0">
                          <div className="text-[13px] font-medium text-neutral-900">
                            {t("settings.geminiImageFormat")}
                          </div>
                          <div className="mt-0.5 text-[12px] text-neutral-500">
                            {t("settings.geminiImageFormatDescription")}
                          </div>
                        </div>
                        <AppSelect
                          className="w-[180px] shrink-0"
                          value={geminiSettings.imageConvertFormat}
                          options={convertFormatOptions.map((option) => ({
                            value: option.value,
                            label: t(option.labelKey)
                          }))}
                          onChange={(nextValue) =>
                            patchGeminiSettings({ imageConvertFormat: nextValue })
                          }
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="h-full rounded-lg border border-dashed border-neutral-200 bg-white/72" />
            )}
          </div>
        </div>
      </section>
    </div>
    </AnimatedPortal>
  );
}
