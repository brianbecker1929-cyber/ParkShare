// api/emails/render.js
//
// Fills [VARIABLE_NAME] placeholders in a template string with real values.
// Throws if anything is left unfilled, so a missing field fails loudly at
// send time instead of emailing a customer a literal "[HOST_NAME]".

export function fillTemplate(template, variables) {
  let html = template;
  for (const [key, value] of Object.entries(variables)) {
    html = html.split(`[${key}]`).join(String(value ?? ""));
  }

  const leftover = html.match(/\[[A-Z_]+\]/g);
  if (leftover) {
    throw new Error(`Unfilled email template variables: ${[...new Set(leftover)].join(", ")}`);
  }
  return html;
}
