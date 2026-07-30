import { EN_COMMON } from "./en.common";
import { EN_CONTACTS } from "./en.contacts";
import { EN_OFFERS } from "./en.offers";
import { EN_CAMPAIGNS } from "./en.campaigns";
import { EN_OPS } from "./en.ops";
import { EN_SETTINGS } from "./en.settings";

/**
 * English dictionary keyed by the Hebrew source string used in the UI.
 * Missing keys fall back to the Hebrew text, so partial coverage is safe.
 */
export const EN: Record<string, string> = {
  ...EN_COMMON,
  ...EN_CONTACTS,
  ...EN_OFFERS,
  ...EN_CAMPAIGNS,
  ...EN_OPS,
  ...EN_SETTINGS,
};