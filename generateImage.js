import { createCanvas, loadImage } from "@napi-rs/canvas";
import https from "https";
import http from "http";

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end",  ()  => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function roundRect(ctx, x, y, w, h, r) {
  if (typeof r === "number") r = { tl: r, tr: r, bl: r, br: r };
  ctx.beginPath();
  ctx.moveTo(x + r.tl, y);
  ctx.lineTo(x + w - r.tr, y);
  ctx.quadraticCurveTo(x + w, y,     x + w, y + r.tr);
  ctx.lineTo(x + w, y + h - r.br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
  ctx.lineTo(x + r.bl, y + h);
  ctx.quadraticCurveTo(x, y + h,     x, y + h - r.bl);
  ctx.lineTo(x, y + r.tl);
  ctx.quadraticCurveTo(x, y,         x + r.tl, y);
  ctx.closePath();
}

// Clean font helpers — Arial is crisp and readable at all sizes
const F = {
  title:      (s) => `bold ${s}px Arial`,
  regular:    (s) => `${s}px Arial`,
  bold:       (s) => `bold ${s}px Arial`,
  number:     (s) => `bold ${s}px Arial`,
};

export async function generateReportImage({
  monthName,
  targetYear,
  periodStartStr,
  periodEndStr,
  totalEvents,
  totalJbs,
  avgMembers,
  weeks,
}) {
  const W = 1600;
  const H = 1000;
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  // ── Background ──────────────────────────────────────────────────────────────
  const bgUrl = process.env.BACKGROUND_URL || "https://i.imgur.com/AD4bzd2.jpeg";
  try {
    const buf = await fetchBuffer(bgUrl);
    const img = await loadImage(buf);
    const scale = Math.max(W / img.width, H / img.height);
    const sw = img.width  * scale;
    const sh = img.height * scale;
    ctx.drawImage(img, (W - sw) / 2, (H - sh) / 2, sw, sh);
  } catch {
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, W, H);
  }

  // ── Dark overlay ────────────────────────────────────────────────────────────
  ctx.fillStyle = "rgba(0, 0, 0, 0.74)";
  ctx.fillRect(0, 0, W, H);

  // ── Header ──────────────────────────────────────────────────────────────────
  ctx.textAlign    = "center";
  ctx.textBaseline = "top";

  ctx.fillStyle = "#ffffff";
  ctx.font      = F.title(108);
  ctx.fillText("MONTHLY REPORT", W / 2, 30);

  ctx.fillStyle = "#cccccc";
  ctx.font      = F.bold(58);
  ctx.fillText(`${monthName.toUpperCase()} ${targetYear}`, W / 2, 152);

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font      = F.regular(34);
  ctx.fillText(`${periodStartStr}  →  ${periodEndStr}`, W / 2, 224);

  // Divider
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth   = 2;
  ctx.beginPath();
  ctx.moveTo(70, 278);
  ctx.lineTo(W - 70, 278);
  ctx.stroke();

  // ── Stat cards (3 across) ───────────────────────────────────────────────────
  const statCards = [
    { label: "TOTAL EVENTS", value: totalEvents, color: "#3498db" },
    { label: "TOTAL JBs",    value: totalJbs,    color: "#e74c3c" },
    { label: "HIGHEST MEMBERS",  value: avgMembers,  color: "#2ecc71" },
  ];

  const cW  = 440;
  const cH  = 148;
  const cY  = 296;
  const cGap = (W - statCards.length * cW) / (statCards.length + 1);

  statCards.forEach((card, i) => {
    const x = cGap + i * (cW + cGap);

    // Card bg
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ctx, x, cY, cW, cH, 18);
    ctx.fill();

    // Colour accent top
    ctx.fillStyle = card.color;
    roundRect(ctx, x, cY, cW, 7, { tl: 18, tr: 18, bl: 0, br: 0 });
    ctx.fill();

    // Big number
    ctx.textAlign    = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle    = "#ffffff";
    ctx.font         = F.number(80);
    ctx.fillText(String(card.value), x + cW / 2, cY + 18);

    // Label below
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font      = F.regular(28);
    ctx.fillText(card.label, x + cW / 2, cY + 110);
  });

  // ── Week cards (4 across) ───────────────────────────────────────────────────
  const wW       = 360;
  const wH       = 450;
  const wY       = 468;
  const wGap     = (W - 4 * wW) / 5;
  const barAreaH = 200;
  const barAreaY = wY + 130;
  const maxVal   = Math.max(...weeks.map((w) => Math.max(w.events, w.jbs)), 1);

  weeks.forEach((week, i) => {
    const x = wGap + i * (wW + wGap);

    // Card bg
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    roundRect(ctx, x, wY, wW, wH, 18);
    ctx.fill();

    // Week title
    ctx.textAlign    = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle    = "#ffffff";
    ctx.font         = F.bold(32);
    ctx.fillText(week.label.toUpperCase(), x + wW / 2, wY + 18);

    // Date range
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font      = F.regular(24);
    ctx.fillText(week.range, x + wW / 2, wY + 60);

    // Divider
    ctx.strokeStyle = "rgba(255,255,255,0.13)";
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(x + 24, wY + 96);
    ctx.lineTo(x + wW - 24, wY + 96);
    ctx.stroke();

    // Side-by-side bars
    const barW  = 60;
    const barGap = 30;
    const barsX  = x + (wW - (barW * 2 + barGap)) / 2;

    const evH = week.events === 0 ? 4 : Math.max(16, (week.events / maxVal) * barAreaH);
    ctx.fillStyle = "#3498db";
    roundRect(ctx, barsX, barAreaY + barAreaH - evH, barW, evH, { tl: 10, tr: 10, bl: 0, br: 0 });
    ctx.fill();

    const jbH = week.jbs === 0 ? 4 : Math.max(16, (week.jbs / maxVal) * barAreaH);
    ctx.fillStyle = "#e74c3c";
    roundRect(ctx, barsX + barW + barGap, barAreaY + barAreaH - jbH, barW, jbH, { tl: 10, tr: 10, bl: 0, br: 0 });
    ctx.fill();

    // Count above bars
    ctx.textBaseline = "bottom";
    ctx.font         = F.number(30);
    ctx.fillStyle    = "#ffffff";
    ctx.fillText(week.events, barsX + barW / 2,                 barAreaY + barAreaH - evH - 4);
    ctx.fillText(week.jbs,    barsX + barW + barGap + barW / 2, barAreaY + barAreaH - jbH - 4);

    // Axis labels
    ctx.textBaseline = "top";
    ctx.fillStyle    = "rgba(255,255,255,0.50)";
    ctx.font         = F.regular(24);
    ctx.fillText("EVT", barsX + barW / 2,                 barAreaY + barAreaH + 10);
    ctx.fillText("JB",  barsX + barW + barGap + barW / 2, barAreaY + barAreaH + 10);

    // Avg members
    ctx.fillStyle = "rgba(255,255,255,0.50)";
    ctx.font      = F.regular(24);
    ctx.fillText("Highest Members", x + wW / 2, wY + wH - 68);

    ctx.fillStyle = "#2ecc71";
    ctx.font      = F.number(36);
    ctx.fillText(week.avgMembers, x + wW / 2, wY + wH - 36);
  });

  // ── Legend ──────────────────────────────────────────────────────────────────
  ctx.textBaseline = "middle";
  const legY = H - 28;
  const legX = W / 2 - 160;
  const sqS  = 22;

  ctx.fillStyle = "#3498db";
  ctx.fillRect(legX, legY - sqS / 2, sqS, sqS);
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.60)";
  ctx.font      = F.regular(26);
  ctx.fillText("Events", legX + sqS + 10, legY);

  ctx.fillStyle = "#e74c3c";
  ctx.fillRect(legX + 170, legY - sqS / 2, sqS, sqS);
  ctx.fillStyle = "rgba(255,255,255,0.60)";
  ctx.fillText("Jail Breaks", legX + 170 + sqS + 10, legY);

  return canvas.toBuffer("image/png");
}
