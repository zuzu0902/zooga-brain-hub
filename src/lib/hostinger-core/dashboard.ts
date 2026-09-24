/** Pure dashboard shaping from Hostinger Core overview + contacts. */
export function buildDashboard(overview: Record<string, any>, all: any[]) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const counts: Record<string, number> = {
    new_lead: 0, active_member: 0, interested: 0, customer: 0, VIP: 0, inactive: 0,
  };
  const interestCounts: Record<string, number> = {};
  let newToday = 0;
  for (const c of all) {
    if (c?.status) counts[c.status] = (counts[c.status] || 0) + 1;
    for (const i of c?.interests || []) interestCounts[i] = (interestCounts[i] || 0) + 1;
    if (c?.status === "new_lead" && c?.created_at && new Date(c.created_at) >= todayStart) newToday++;
  }
  const ov = overview?.overview ?? overview ?? {};
  const byStatus = ov.contacts_by_status ?? ov.status_counts;
  if (byStatus && typeof byStatus === "object") for (const k of Object.keys(counts)) {
    if (typeof byStatus[k] === "number") counts[k] = byStatus[k];
  }
  const recent = Array.isArray(ov.recent_interactions) ? ov.recent_interactions : [];
  return {
    total: typeof ov.contacts_total === "number" ? ov.contacts_total : all.length,
    newToday: typeof ov.new_leads_today === "number" ? ov.new_leads_today : newToday,
    counts,
    topInterests: Object.entries(interestCounts).sort((a, b) => b[1] - a[1]).slice(0, 6),
    recent,
    topEngaged: [...all].sort((a, b) => (b?.engagement_score || 0) - (a?.engagement_score || 0)).slice(0, 6),
  };
}
