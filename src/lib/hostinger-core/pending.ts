import { toast } from "sonner";

/** MIGRATION: shown for actions with no Hostinger Core API yet. No database fallback. */
export const PENDING_CORE_MSG = "פעולה זו מושבתת זמנית — ממתינה להשלמת המעבר ל-Hostinger Core";

export function pendingCore() {
  toast.info(PENDING_CORE_MSG);
}
