export type Lang = "he" | "en";

let currentLang: Lang = "he";

export function setCurrentLang(l: Lang) {
  currentLang = l;
}

export function getCurrentLang(): Lang {
  return currentLang;
}