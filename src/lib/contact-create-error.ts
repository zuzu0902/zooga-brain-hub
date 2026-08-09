/**
 * Classified contact-creation failure. Never carries a full phone number.
 */
import { maskPhone } from "@/lib/zero-loss/core";

export class ContactCreateError extends Error {
  code: string;
  correlation_id: string;
  phone_masked: string | null;
  retryable: boolean;

  constructor(args: {
    code?: string;
    message?: string;
    phone?: string | null;
    correlationId?: string | null;
    retryable?: boolean;
  }) {
    const code = args.code ?? "contact_create_failed";
    super(`${code}: ${args.message ?? "contact could not be created"}`);
    this.name = "ContactCreateError";
    this.code = code;
    this.correlation_id = args.correlationId ?? cryptoRandomId();
    this.phone_masked = maskPhone(args.phone ?? null);
    this.retryable = args.retryable ?? true;
  }
}

function cryptoRandomId(): string {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return `corr_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }
}
