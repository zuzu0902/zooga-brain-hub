// Container healthcheck: /health only, no secrets, no session data.
const port = process.env.PORT || "8080";
try {
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  if (!res.ok) process.exit(1);
  const body = await res.json();
  process.exit(body?.ok === true ? 0 : 1);
} catch {
  process.exit(1);
}
