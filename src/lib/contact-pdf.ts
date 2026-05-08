import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import {
  STATUS_LABELS, SOURCE_LABELS, SALES_TEMP_LABELS,
  INTEREST_LABELS, LIFESTYLE_LABELS, INTERACTION_TYPE_LABELS,
  formatDate,
} from "@/lib/i18n";

function row(label: string, value: any): string {
  if (value === null || value === undefined || value === "" ||
      (Array.isArray(value) && value.length === 0)) return "";
  const v = Array.isArray(value) ? value.join(", ") : String(value);
  return `<tr><td class="lbl">${label}</td><td class="val">${escapeHtml(v)}</td></tr>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function section(title: string, body: string): string {
  if (!body.trim()) return "";
  return `<section><h2>${title}</h2><table>${body}</table></section>`;
}

export async function exportContactToPdf(contact: any, interactions: any[] = []) {
  const name = contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "ללא שם";
  const generatedAt = new Date().toLocaleString("he-IL");

  const interestsLabels = (contact.interests || []).map((i: string) => INTEREST_LABELS[i] || i);
  const lifestyleLabels = (contact.lifestyle_tags || []).map((i: string) => LIFESTYLE_LABELS[i] || i);

  const identity = [
    row("שם מלא", name),
    row("טלפון", contact.phone),
    row("WhatsApp", contact.whatsapp_number),
    row("אימייל", contact.email),
    row("מין", contact.gender === "male" ? "זכר" : contact.gender === "female" ? "נקבה" : contact.gender),
    row("גיל", contact.age),
    row("טווח גיל", contact.age_range),
    row("עיר", contact.city),
    row("אזור", contact.region),
    row("מצב משפחתי", contact.relationship_status),
  ].join("");

  const status = [
    row("סטטוס", STATUS_LABELS[contact.status] || contact.status),
    row("מקור", SOURCE_LABELS[contact.source] || contact.source),
    row("טמפרטורת מכירה", SALES_TEMP_LABELS[contact.sales_temperature] || contact.sales_temperature),
    row("כוונת רכישה", contact.purchase_intent),
    row("שלב המרה", contact.conversion_stage),
    row("הסכמה לשיווק", contact.consent_marketing ? "כן" : "לא"),
    row("תאריך הסכמה", contact.consent_date ? formatDate(contact.consent_date) : null),
    row("ציון מעורבות", contact.engagement_score),
    row("ציון פעילות", contact.activity_score),
    row("מס׳ אינטראקציות", contact.interaction_count),
    row("אינטראקציה אחרונה", contact.last_interaction_at ? formatDate(contact.last_interaction_at) : null),
  ].join("");

  const profile = [
    row("תחומי עניין", interestsLabels),
    row("סגנון חיים", lifestyleLabels),
    row("תגיות", contact.tags),
    row("תחביבים", contact.hobbies),
    row("העדפות אירועים", contact.preferred_events),
    row("העדפות נסיעה", contact.travel_preferences),
    row("פעילויות מועדפות", contact.favorite_activity_types),
    row("תגיות אישיות", contact.personality_tags),
    row("צרכים רגשיים", contact.emotional_needs),
    row("יעדים חברתיים", contact.social_goals),
    row("יעדים זוגיים", contact.relationship_goals),
    row("סגנון נסיעה מועדף", contact.preferred_trip_style),
    row("סגנון חברתי מועדף", contact.preferred_social_style),
  ].join("");

  const ai = [
    row("סיכום AI", contact.ai_summary),
    row("הערות פרופיל AI", contact.ai_profile_notes),
    row("פעולה מומלצת הבאה", contact.ai_recommended_next_action),
    row("התאמת הצעה", contact.ai_offer_fit),
    row("דגלי סיכון", contact.ai_risk_flags),
    row("ציון בטחון AI", contact.ai_confidence_score),
    row("פרופיל רגשי", contact.emotional_profile),
    row("סגנון תקשורת", contact.communication_style),
    row("פרופיל חברתי", contact.social_profile),
    row("פרופיל מכירה", contact.sales_profile),
    row("רגישות מחיר", contact.budget_sensitivity),
    row("פוטנציאל VIP", contact.vip_potential),
    row("מוכנות זוגית", contact.relationship_readiness),
    row("סיגנל בדידות", contact.loneliness_signal),
    row("ציון פתיחות", contact.openness_score),
    row("התאמה לקהילה", contact.community_fit_score),
    row("צרכים סבירים", contact.likely_needs),
    row("טריגרים להחלטה", contact.decision_triggers),
    row("התנגדויות", contact.objections),
  ].join("");

  const interactionsRows = (interactions || []).slice(0, 50).map((i: any) => {
    const t = INTERACTION_TYPE_LABELS[i.type] || i.type;
    const ts = formatDate(i.timestamp);
    const c = escapeHtml(String(i.content || "").slice(0, 300));
    return `<tr><td class="lbl" style="white-space:nowrap">${ts}</td><td class="lbl" style="white-space:nowrap">${t}</td><td class="val">${c}</td></tr>`;
  }).join("");

  const notes = contact.notes ? `<section><h2>הערות</h2><p class="notes">${escapeHtml(contact.notes)}</p></section>` : "";

  const html = `
    <div id="zooga-pdf-root" dir="rtl" lang="he" style="
      width: 794px; padding: 40px; background: #ffffff; color: #0f172a;
      font-family: 'Heebo','Assistant','Segoe UI',Arial,sans-serif;
      -webkit-font-smoothing: antialiased; line-height: 1.5;
    ">
      <style>
        #zooga-pdf-root h1 { font-size: 26px; margin: 0 0 4px; font-weight: 800; }
        #zooga-pdf-root .sub { color: #64748b; font-size: 12px; margin-bottom: 18px; }
        #zooga-pdf-root .header { display:flex; align-items:center; justify-content:space-between;
          padding-bottom: 14px; border-bottom: 2px solid #f59e0b; margin-bottom: 18px; }
        #zooga-pdf-root .brand { font-weight: 800; color:#f59e0b; font-size:14px; letter-spacing:0.5px; }
        #zooga-pdf-root section { margin-bottom: 18px; break-inside: avoid; }
        #zooga-pdf-root h2 { font-size: 14px; font-weight: 700; color:#0f172a;
          background: #f8fafc; padding: 8px 12px; border-right: 4px solid #f59e0b;
          border-radius: 6px; margin: 0 0 8px; }
        #zooga-pdf-root table { width:100%; border-collapse: collapse; }
        #zooga-pdf-root td { padding: 6px 10px; vertical-align: top; font-size: 12px;
          border-bottom: 1px solid #f1f5f9; }
        #zooga-pdf-root td.lbl { color:#64748b; width: 35%; font-weight:600; }
        #zooga-pdf-root td.val { color:#0f172a; }
        #zooga-pdf-root .notes { font-size: 12px; white-space: pre-wrap;
          background:#fef3c7; padding: 12px; border-radius: 6px; margin: 0; }
        #zooga-pdf-root .footer { margin-top: 24px; padding-top: 12px;
          border-top: 1px solid #e2e8f0; color:#94a3b8; font-size: 10px; text-align: center; }
      </style>
      <div class="header">
        <div>
          <h1>${escapeHtml(name)}</h1>
          <div class="sub">${contact.phone ? `טל: ${escapeHtml(contact.phone)} · ` : ""}${escapeHtml(SOURCE_LABELS[contact.source] || contact.source || "")}</div>
        </div>
        <div class="brand">ZOOGA · CRM</div>
      </div>
      ${section("פרטי זיהוי", identity)}
      ${section("סטטוס ומכירה", status)}
      ${section("פרופיל ותחומי עניין", profile)}
      ${section("מודיעין AI", ai)}
      ${notes}
      ${interactionsRows ? `<section><h2>היסטוריית אינטראקציות (${interactions.length})</h2><table>${interactionsRows}</table></section>` : ""}
      <div class="footer">הופק ב-${escapeHtml(generatedAt)} · Zooga CRM</div>
    </div>
  `;

  // Render inside an isolated iframe so the host page's CSS (oklch tokens,
  // Tailwind resets, etc.) cannot leak in — html2canvas 1.x cannot parse
  // oklch() and crashes on inherited values.
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;left:-10000px;top:0;width:900px;height:100px;border:0;background:#fff;";
  document.body.appendChild(iframe);
  await new Promise<void>((res) => {
    iframe.onload = () => res();
    iframe.srcdoc = `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;background:#fff;color:#0f172a;
        font-family:'Heebo','Assistant','Segoe UI',Arial,sans-serif;}
    </style></head><body>${html}</body></html>`;
  });

  const idoc = iframe.contentDocument!;
  const node = idoc.getElementById("zooga-pdf-root") as HTMLElement;
  // Resize iframe to content so html2canvas captures the full height
  iframe.style.height = node.scrollHeight + 40 + "px";

  try {
    const canvas = await html2canvas(node, {
      scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false,
      windowWidth: node.scrollWidth, windowHeight: node.scrollHeight,
    });

    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW = pageW;
    const imgH = (canvas.height * imgW) / canvas.width;

    const imgData = canvas.toDataURL("image/jpeg", 0.92);

    if (imgH <= pageH) {
      pdf.addImage(imgData, "JPEG", 0, 0, imgW, imgH);
    } else {
      // Multi-page: slice the canvas
      const pageHeightPx = (pageH * canvas.width) / pageW;
      let renderedHeight = 0;
      const sliceCanvas = document.createElement("canvas");
      const ctx = sliceCanvas.getContext("2d")!;
      sliceCanvas.width = canvas.width;
      let pageIdx = 0;
      while (renderedHeight < canvas.height) {
        const sliceH = Math.min(pageHeightPx, canvas.height - renderedHeight);
        sliceCanvas.height = sliceH;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
        ctx.drawImage(canvas, 0, renderedHeight, canvas.width, sliceH, 0, 0, canvas.width, sliceH);
        const sliceData = sliceCanvas.toDataURL("image/jpeg", 0.92);
        const sliceMmH = (sliceH * imgW) / canvas.width;
        if (pageIdx > 0) pdf.addPage();
        pdf.addImage(sliceData, "JPEG", 0, 0, imgW, sliceMmH);
        renderedHeight += sliceH;
        pageIdx += 1;
      }
    }

    const safeName = name.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 60) || "contact";
    pdf.save(`zooga_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf`);
  } finally {
    document.body.removeChild(iframe);
  }
}