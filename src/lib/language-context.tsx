import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { EN } from "@/lib/locales";
import { setCurrentLang } from "@/lib/locale-state";

export type Lang = "he" | "en";

type LanguageState = {
  lang: Lang;
  dir: "rtl" | "ltr";
  setLang: (l: Lang) => void;
  toggle: () => void;
  /** Translate a Hebrew source string. Falls back to the Hebrew text. */
  t: (he: string) => string;
};

const STORAGE_KEY = "zooga-lang";

const LanguageCtx = createContext<LanguageState>({
  lang: "he",
  dir: "rtl",
  setLang: () => {},
  toggle: () => {},
  t: (he) => he,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  // SSR + first paint are always Hebrew; the stored preference is applied
  // after hydration so markup matches and no mismatch warning appears.
  const [lang, setLangState] = useState<Lang>("he");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "en" || stored === "he") setLangState(stored);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const dir = lang === "en" ? "ltr" : "rtl";
    setCurrentLang(lang);
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("dir", dir);
      document.documentElement.setAttribute("lang", lang);
    }
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<LanguageState>(() => {
    const t = (he: string) => (lang === "en" ? (EN[he] ?? he) : he);
    return {
      lang,
      dir: lang === "en" ? "ltr" : "rtl",
      setLang,
      toggle: () => setLang(lang === "he" ? "en" : "he"),
      t,
    };
  }, [lang, setLang]);

  return <LanguageCtx.Provider value={value}>{children}</LanguageCtx.Provider>;
}

export const useLanguage = () => useContext(LanguageCtx);

/** Convenience hook: `const t = useT(); t("שמור")` */
export const useT = () => useContext(LanguageCtx).t;