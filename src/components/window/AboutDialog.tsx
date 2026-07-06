import { Cpu, Dna, GitFork, Info, ScrollText, Tag, UserRound, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "../../lib/cn";
import { openExternalUrl } from "../../lib/tauri";
import { AnimatedPortal } from "../ui/AnimatedPortal";
import { Button } from "../ui/Button";

type AboutTab = "version" | "statement" | "credits";
type CreditKind = "author" | "backend" | "compute";

interface CreditItem {
  name: string;
  roleKey: string;
  descriptionKey: string;
  kind: CreditKind;
}

const appVersion = "Beta 2";
const githubUrl = "https://github.com/Aeka0/DatasetsDeputy";

const creditItems: CreditItem[] = [
  {
    name: "Aeka",
    roleKey: "about.credits.aeka.role",
    descriptionKey: "about.credits.aeka.description",
    kind: "author"
  },
  {
    name: "EvoMap",
    roleKey: "about.credits.evoMap.role",
    descriptionKey: "about.credits.evoMap.description",
    kind: "compute"
  },
  {
    name: "WD14 tagger ecosystem",
    roleKey: "about.credits.wd14Tagger.role",
    descriptionKey: "about.credits.wd14Tagger.description",
    kind: "backend"
  },
  {
    name: "CLIP / ONNX Runtime",
    roleKey: "about.credits.clipOnnx.role",
    descriptionKey: "about.credits.clipOnnx.description",
    kind: "backend"
  },
  {
    name: "Remote LLM providers",
    roleKey: "about.credits.remoteProviders.role",
    descriptionKey: "about.credits.remoteProviders.description",
    kind: "backend"
  }
];

const creditIconMap = {
  author: UserRound,
  backend: Cpu,
  compute: Dna
} satisfies Record<CreditKind, typeof UserRound>;

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<AboutTab>("version");
  const activeTabLabel = t(`about.tabs.${activeTab}`);

  return (
    <AnimatedPortal open={open}>
      <div className="no-drag fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/18 px-5">
        <section
          className="app-dialog-panel flex h-[520px] w-full max-w-[760px] overflow-hidden rounded-lg border shadow-[0_24px_72px_rgba(23,23,23,0.22)]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="about-title"
        >
          <aside className="flex w-[208px] shrink-0 flex-col border-r border-neutral-200 bg-neutral-50/90">
            <div className="flex h-14 items-center border-b border-neutral-200 px-4">
              <h2 id="about-title" className="m-0 truncate text-[15px] font-semibold text-neutral-950">
                Datasets Deputy
              </h2>
            </div>

            <nav className="space-y-1 px-2 py-3" aria-label={t("about.tabsLabel")}>
              <AboutTabButton
                active={activeTab === "version"}
                icon={Tag}
                label={t("about.tabs.version")}
                onClick={() => setActiveTab("version")}
              />
              <AboutTabButton
                active={activeTab === "statement"}
                icon={ScrollText}
                label={t("about.tabs.statement")}
                onClick={() => setActiveTab("statement")}
              />
              <AboutTabButton
                active={activeTab === "credits"}
                icon={UserRound}
                label={t("about.tabs.credits")}
                onClick={() => setActiveTab("credits")}
              />
            </nav>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col bg-white">
            <header className="flex h-14 shrink-0 items-center justify-between border-b border-neutral-200 px-5">
              <div className="text-[15px] font-semibold text-neutral-950">{activeTabLabel}</div>
              <Button
                type="button"
                variant="icon"
                aria-label={t("actions.close")}
                title={t("actions.close")}
                onClick={onClose}
              >
                <X size={18} />
              </Button>
            </header>

            <div className="min-h-0 flex-1 overflow-hidden bg-neutral-50/42">
              {activeTab === "version" ? <VersionTab /> : null}
              {activeTab === "statement" ? <StatementTab /> : null}
              {activeTab === "credits" ? <CreditsTab items={creditItems} /> : null}
            </div>
          </div>
        </section>
      </div>
    </AnimatedPortal>
  );
}

function VersionTab() {
  const { t } = useTranslation();

  return (
    <div className="hover-scrollbar h-full overflow-y-auto px-5 py-5">
      <div className="space-y-4">
        <section className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-neutral-900">
            <Tag size={16} />
            {t("about.versionTitle")}
          </div>
          <dl className="m-0 grid grid-cols-[96px_minmax(0,1fr)] gap-x-4 gap-y-3 text-[13px]">
            <dt className="text-neutral-500">{t("about.version")}</dt>
            <dd className="m-0 font-medium text-neutral-900">{appVersion}</dd>
            <dt className="text-neutral-500">{t("about.repository")}</dt>
            <dd className="m-0 min-w-0">
              <a
                className="inline-flex max-w-full items-center gap-1.5 text-[13px] font-medium text-neutral-900 underline decoration-neutral-300 underline-offset-4 transition hover:text-neutral-600"
                href={githubUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => {
                  event.preventDefault();
                  void openExternalUrl(githubUrl);
                }}
              >
                <GitFork size={15} className="shrink-0" />
                <span className="truncate">Aeka0/DatasetsDeputy</span>
              </a>
            </dd>
          </dl>
        </section>
        <p className="m-0 rounded-lg border border-neutral-200 bg-white p-4 text-[13px] leading-5 text-neutral-600">
          {t("about.statement.development")}
        </p>
      </div>
    </div>
  );
}

function StatementTab() {
  const { t } = useTranslation();
  const statements = [
    "about.statement.scope",
    "about.statement.ownership",
    "about.statement.local",
    "about.statement.development",
    "about.statement.responsibility"
  ];

  return (
    <div className="hover-scrollbar h-full overflow-y-auto px-5 py-5">
      <div className="space-y-4">
        <section className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-neutral-900">
            <Info size={16} />
            {t("about.statementTitle")}
          </div>
          <div className="space-y-3 text-[13px] leading-5 text-neutral-600">
            {statements.map((key) => (
              <p key={key} className="m-0">
                {t(key)}
              </p>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function CreditsTab({ items }: { items: CreditItem[] }) {
  const { t } = useTranslation();

  return (
    <div className="flex h-full min-h-0 flex-col px-5 py-5">
      <p className="m-0 shrink-0 text-[13px] leading-5 text-neutral-600">
        {t("about.creditsIntro")}
      </p>
      <div className="hover-scrollbar mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid grid-cols-2 gap-4 pb-1">
          {items.map((item) => (
            <CreditCard key={item.name} item={item} />
          ))}
        </div>
      </div>
    </div>
  );
}

function CreditCard({ item }: { item: CreditItem }) {
  const { t } = useTranslation();
  const Icon = creditIconMap[item.kind];

  return (
    <article className="flex min-h-[132px] gap-3 rounded-lg border border-neutral-200 bg-white p-4">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-neutral-900/[0.07] text-neutral-700">
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <h3 className="m-0 truncate text-[14px] font-semibold text-neutral-950" title={item.name}>
          {item.name}
        </h3>
        <div className="mt-1 text-[12px] font-medium text-neutral-500">{t(item.roleKey)}</div>
        <p className="m-0 mt-2 text-[12px] leading-5 text-neutral-600">
          {t(item.descriptionKey)}
        </p>
      </div>
    </article>
  );
}

function AboutTabButton({
  active,
  icon: Icon,
  label,
  onClick
}: {
  active: boolean;
  icon: typeof ScrollText;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "sidebar-item sidebar-nav-button flex h-9 w-full items-center gap-2 rounded px-3 text-left text-[13px]",
        active && "sidebar-item-selected sidebar-nav-button-active"
      )}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      <Icon size={16} className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}
