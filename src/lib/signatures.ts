// Localized HTML email signatures (app send path). Kept in sync with
// automation/lib/signatures.cjs. The signature is identical across accounts;
// only the language varies, by the email's language (en|tr): translated
// tagline + link labels and a website link to the localized LANDING page
// egehakankaraagac.com/<lang> (the separate /report page was removed and folded
// into the landing, June 2026). Applied at send time in place of the
// static User.signature so a mixed-language account signs each mail correctly.
// German was retired (June 2026) — DACH recipients get the English signature;
// any stale 'de' on an old row coerces to 'en'.

export type SignatureLang = "en" | "tr";

const LINKEDIN = "https://www.linkedin.com/in/egehakankar";
const CAL = "https://cal.com/ege-hakan-karaagac-s7l6lv/30min";
const SITE_BASE = "https://egehakankaraagac.com";

const COPY: Record<SignatureLang, { role: string; pitch: string; linkedin: string; book: string }> = {
  en: {
    role: "Independent AI Engineer &middot; Ex-Amazon &middot; Ex-Accenture &middot; Founder BrandVox AI",
    pitch: "The first AI tool your operation actually uses, measured in hours saved and money recovered",
    linkedin: "LinkedIn",
    book: "Book a 30-min call",
  },
  tr: {
    role: "Bağımsız Yapay Zeka Mühendisi &middot; Eski Amazon &middot; Eski Accenture &middot; BrandVox AI Kurucusu",
    pitch: "İşletmenizin gerçekten kullandığı ilk yapay zeka aracı; değeri kazandırdığı saatlerle ve geri kazanılan parayla ölçülür",
    linkedin: "LinkedIn",
    book: "30 dakikalık görüşme ayarlayın",
  },
};

export function normSignatureLang(lang?: string | null): SignatureLang {
  return lang === "tr" ? "tr" : "en";
}

export function signatureHtml(lang?: string | null, firstTouch = false): string {
  const l = normSignatureLang(lang);
  const c = COPY[l];
  const url = `${SITE_BASE}/${l}`;
  const display = `egehakankaraagac.com/${l}`;
  // First-touch cold emails omit the cal.com booking link. A calendar link in a
  // cold send suppresses replies and is the most spam/phishing-flagged link type,
  // and the body already carries the report link. The booking link returns on
  // follow-ups (which thread, so firstTouch is false there), after a positive reply.
  const calLink = firstTouch
    ? ""
    : ` &middot; <a href="${CAL}" style="color:#000000;text-decoration:underline;">${c.book}</a>`;
  return (
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.4;color:#000000;">` +
    `<div style="margin:0;color:#000000;"><strong style="color:#000000;font-weight:600;">Ege Hakan Karaagac</strong></div>` +
    `<div style="margin:0;color:#000000;">${c.role}</div>` +
    `<div style="margin:0;color:#000000;">${c.pitch}</div>` +
    `<div style="margin:10px 0 0 0;color:#000000;">` +
    `<a href="${url}" style="color:#000000;text-decoration:underline;">${display}</a> &middot; ` +
    `<a href="${LINKEDIN}" style="color:#000000;text-decoration:underline;">${c.linkedin}</a>` +
    calLink +
    `</div>\n</div>`
  );
}
