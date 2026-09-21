# Production Tamar prompt correction

## Scope
- Inspect the live database schema and the deployed Tamar runtime selection path to identify the single authoritative prompt source and volatile Canary context stores.
- Apply one narrowly scoped database transaction for canonical Canary `972512277533`: clear only mutable conversation context/handoff/cache state, replace the selected Tamar policy in the existing authoritative field, and retire any competing active prompt/version without deleting audit history.
- Preserve consent, immutable events, inbound/outbound history, delivery safeguards, Canary restrictions, and all group/broadcast behavior.

## Verification
- Query the live database for the exact selected prompt source, exact-opening presence, absence of active Azerbaijan/Baku text, and counts of cleared volatile records.
- Add a focused regression test that exercises the production-authoritative prompt/config loader rather than code constants alone.
- Run focused and full tests, type checking, and the production build; then publish and wait for a ready/success result.

## Technical details
- Use existing tables/columns and selection rules; do not create `agent_definitions` or a parallel prompt store unless it is already the active production source.
- Perform data corrections through a guarded, idempotent transaction with normalized Israeli phone matching.
- Report only table/column mapping, counts, booleans, test/build results, commit identifier, and deployment status—never secrets, private records, or full prompt text.
