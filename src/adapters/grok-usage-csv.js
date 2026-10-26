import { parseCsv, parseNumber } from "../core/csv.js";

const TOKEN_FIELDS = {
  prompt: "prompt-text-tokens",
  completion: "completion-text-tokens",
  cached: "cached-prompt-text-tokens",
  cacheWrite: "cache-write-text-tokens"
};

/** Provider adapter: validate(source) + parse(source) -> normalized usage events. */
export const grokUsageCsvAdapter = {
  id: "grok-usage-csv",
  label: "Grok Usage CSV",
  supports(fileName, headerText = "") {
    return fileName.toLowerCase().endsWith(".csv") && headerText.includes("Event Time") && headerText.includes("Usage") && headerText.includes("Product");
  },
  parse(text) {
    const sourceRows = parseCsv(text);
    const headers = Object.keys(sourceRows[0] ?? {});
    for (const required of ["Event Time", "Usage", "Product"]) {
      if (!headers.includes(required)) throw new Error('Not a supported Grok Usage CSV: missing "' + required + '" column.');
    }
    const errors = [], events = [];
    sourceRows.forEach((row, index) => {
      if (!row["Event Time"] && !row.Usage && !row.Product) return;
      const timestamp = Date.parse(row["Event Time"]);
      if (!Number.isFinite(timestamp)) { errors.push(index + 2); return; }
      let usage;
      try { usage = JSON.parse(row.Usage || "{}"); } catch { errors.push(index + 2); return; }
      const tokens = Object.fromEntries(Object.entries(TOKEN_FIELDS).map(([key, field]) => [key, parseNumber(usage[field])]));
      const product = row.Product?.trim() || "Grok (unspecified product)";
      const userEmail = row["User Email"]?.trim() || "";
      const model = row.Model?.trim() || "Grok (unspecified)";
      const usageType = row["Usage Type"]?.trim() || "Uncategorised";
      const id = row["Billing Item ID"]?.trim() || "grok-" + timestamp + "-" + encodeURIComponent([model, usageType, tokens.prompt, tokens.completion, tokens.cached, tokens.cacheWrite, row["Pricing Contracted"] || ""].join("|"));
      events.push({ id, timestamp, product, model, userEmail, usageType, chargeCategory: row["Charge Category"] || "usage", currency: row["Pricing Currency"] || "USD", cost: parseNumber(row["Pricing Contracted"]), ...tokens, total: Object.values(tokens).reduce((sum, value) => sum + value, 0), rawUsage: usage });
    });
    if (!events.length) throw new Error("No valid Grok usage rows found. Check the CSV format and Product column.");
    events.sort((a, b) => a.timestamp - b.timestamp);
    return { events, sourceRows: sourceRows.length, skippedRows: errors.length, errors };
  }
};

export const usageAdapters = [grokUsageCsvAdapter];
