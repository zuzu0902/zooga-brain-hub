# Architecture rules

- Daily operator views read through the authenticated Hostinger Core browser client; never introduce database fallbacks, so Core remains authoritative.
- The Control Center contract is validated in a browser-safe module and shared through one session-keyed query, so all daily views render the same snapshot and fail explicitly on malformed responses.
- Operator read-only lists are separate from delivery and campaign modules, so presentation refactors cannot dispatch messages or change runtime behavior.
- Preserve the existing pathless app layout and public URLs; put contacts list content in its index leaf, so detail routes always mount through Outlet.