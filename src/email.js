// Sending email (confirm-your-email and reset-password links) through Brevo's
// transactional API. Needs the Worker secret BREVO_API_KEY and the variable
// EMAIL_FROM (a sender address verified in Brevo; EMAIL_FROM_NAME optional).
// Without them, email links are simply off.
export const emailEnabled = env => !!(env.BREVO_API_KEY && env.EMAIL_FROM);

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// A plain, mobile-friendly email with one button.
export function linkEmail({ name, intro, button, url, outro }) {
  const html = `<!doctype html><html><body style="margin:0;background:#f7f7f5;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#141716">
<div style="max-width:480px;margin:0 auto;padding:32px 20px">
<p style="font-size:20px;font-weight:600;margin:0 0 20px">Split It</p>
<div style="background:#fff;border-radius:20px;padding:24px">
<p style="margin:0 0 12px;font-size:16px">Hi ${esc(name)},</p>
<p style="margin:0 0 20px;font-size:15px;line-height:22px">${esc(intro)}</p>
<a href="${esc(url)}" style="display:inline-block;background:#141716;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:999px">${esc(button)}</a>
<p style="margin:20px 0 0;font-size:13px;line-height:19px;color:#6b706e">${esc(outro)}</p>
<p style="margin:12px 0 0;font-size:12px;line-height:17px;color:#9a9e9c;word-break:break-all">${esc(url)}</p>
</div></div></body></html>`;
  const text = `Hi ${name},\n\n${intro}\n\n${button}: ${url}\n\n${outro}\n`;
  return { html, text };
}

export async function sendEmail(env, { to, toName, subject, html, text }) {
  if (!emailEnabled(env)) throw new Error("Email is not set up.");
  // BREVO_API_URL only for local testing against a fake; normally unset.
  const res = await fetch(env.BREVO_API_URL || "https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_API_KEY, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ sender: { email: env.EMAIL_FROM, name: env.EMAIL_FROM_NAME || "Split It" }, to: [{ email: to, ...(toName ? { name: toName } : {}) }], subject, htmlContent: html, textContent: text }),
  });
  if (!res.ok) throw new Error("Email service answered " + res.status);
}
