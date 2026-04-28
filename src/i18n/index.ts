import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";

const fallbackLanguage = "en-US";

const browserLanguage =
  typeof navigator === "undefined" ? fallbackLanguage : navigator.language;

void i18next.use(initReactI18next).init({
  resources: {
    "en-US": { translation: enUS },
    "zh-CN": { translation: zhCN }
  },
  lng: browserLanguage.startsWith("zh") ? "zh-CN" : fallbackLanguage,
  fallbackLng: fallbackLanguage,
  interpolation: {
    escapeValue: false
  }
});

export default i18next;
