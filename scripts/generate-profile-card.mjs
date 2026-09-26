// generate-profile-card.mjs
// Generates 3 self-hosted SVG cards for the GitHub profile README:
//   assets/system-info.svg    -- terminal "SYSTEM.INFO" identity panel + particle art
//   assets/stats-bricks.svg   -- total contributions / current streak / longest streak
//   assets/projects-grid.svg  -- featured project cards
//
// Data source: GitHub GraphQL API using GITHUB_TOKEN (automatically provided
// inside GitHub Actions -- no manual PAT needed). If no token is available
// (e.g. running locally without one), falls back to the last-known-real
// snapshot values below so the script still produces a correct-looking
// preview instead of crashing.
//
// Run: node generate-profile-card.mjs
// In CI: GITHUB_TOKEN is injected automatically by actions/checkout + the
// workflow's `env:` block -- see .github/workflows/generate-profile.yml

import { writeFileSync, mkdirSync } from "fs";

const USERNAME = "MasRizqi07";
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;

// ---- last-known-real snapshot (used only if no token is available) ----
const FALLBACK = {
  totalContributions: 582,
  contributionRangeStart: "Feb 2, 2025",
  currentStreak: 29,
  currentStreakRange: "Aug 27 - Sep 24",
  longestStreak: 29,
  longestStreakRange: "Aug 27 - Sep 24",
  totalStars: 1,
  totalCommits: 486,
  totalPRs: 37,
};

const PROJECTS = [
  { name: "ICL-ITATS", repo: "MasRizqi07/ICL-ITATS", desc: "Career Intelligence Platform for GEMASTIK XIX 2026", stack: ["Laravel", "PHP", "Blade"] },
  { name: "CuanCerdas", repo: "MasRizqi07/CuanCerdas", desc: "Robo-advisor & financial literacy app for Gen Z", stack: ["Laravel", "Livewire"] },
  { name: "BecomingNext-Project", repo: "MasRizqi07/BecomingNext-Project", desc: "Reflection journaling app with insight radar chart", stack: ["React", "Firebase"] },
  { name: "ProjectBuRahmiRPL-IKI", repo: "MasRizqi07/ProjectBuRahmiRPL-IKI", desc: "High-concurrency concert ticket checkout engine", stack: ["Next.js", "Redis"] },
];

async function ghGraphQL(query) {
  if (!TOKEN) return null;
  try {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) {
      console.error("GraphQL request failed:", res.status, await res.text());
      return null;
    }
    const json = await res.json();
    if (json.errors) {
      console.error("GraphQL returned errors (continuing with fallback):", JSON.stringify(json.errors));
    }
    return json.data || null;
  } catch (err) {
    console.error("GraphQL request threw an exception (continuing with fallback):", err.message);
    return null;
  }
}

function computeStreaks(weeks) {
  // weeks: array of { contributionDays: [{ date, contributionCount }] }
  const days = weeks.flatMap((w) => w.contributionDays);
  let longest = 0,
    current = 0,
    running = 0,
    longestRange = ["", ""],
    runningStart = null;
  let currentStreakRange = ["", ""];

  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    if (d.contributionCount > 0) {
      if (running === 0) runningStart = d.date;
      running++;
      if (running > longest) {
        longest = running;
        longestRange = [runningStart, d.date];
      }
    } else {
      running = 0;
    }
  }
  // current streak = trailing streak ending today (or the most recent day with data)
  let trailing = 0;
  let trailingEnd = days[days.length - 1]?.date || "";
  let trailingStart = trailingEnd;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].contributionCount > 0) {
      trailing++;
      trailingStart = days[i].date;
    } else {
      break;
    }
  }
  current = trailing;
  currentStreakRange = [trailingStart, trailingEnd];

  return { longest, longestRange, current, currentStreakRange };
}

async function fetchLiveData() {
  const query = `
    query {
      user(login: "${USERNAME}") {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks { contributionDays { date contributionCount } }
          }
        }
        repositories(first: 4, ownerAffinity: OWNER, isFork: false, orderBy: {field: STARGAZERS, direction: DESC}) {
          nodes { name stargazerCount primaryLanguage { name } }
        }
      }
    }`;

  try {
    const data = await ghGraphQL(query);
    const cal = data?.user?.contributionsCollection?.contributionCalendar;

    // Defensive: the default GITHUB_TOKEN can sometimes return an empty
    // calendar (no read:user scope) instead of a clean error. Treat "no
    // weeks" the same as "no data" and fall back, rather than crashing.
    if (!cal || !Array.isArray(cal.weeks) || cal.weeks.length === 0) {
      console.log("Live contribution data unavailable or empty -- using fallback snapshot.");
      return null;
    }

    const { longest, longestRange, current, currentStreakRange } = computeStreaks(cal.weeks);
    const fmt = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const firstDay = cal.weeks[0]?.contributionDays?.[0]?.date;

    return {
      totalContributions: cal.totalContributions,
      contributionRangeStart: firstDay ? fmt(firstDay) : FALLBACK.contributionRangeStart,
      currentStreak: current,
      currentStreakRange: currentStreakRange[0] ? `${fmt(currentStreakRange[0])} - ${fmt(currentStreakRange[1])}` : FALLBACK.currentStreakRange,
      longestStreak: longest,
      longestStreakRange: longestRange[0] ? `${fmt(longestRange[0])} - ${fmt(longestRange[1])}` : FALLBACK.longestStreakRange,
    };
  } catch (err) {
    console.error("fetchLiveData failed unexpectedly -- using fallback snapshot:", err.message);
    return null;
  }
}

// ---------------------------------------------------------------------
// SVG building blocks
// ---------------------------------------------------------------------

const COLORS = {
  bg: "#0a0e1a",
  panel: "#0f1420",
  border: "#2d2f45",
  accent: "#8b7cf6",
  accent2: "#22d3ee",
  text: "#c9d1d9",
  dim: "#6b7280",
  key: "#8b7cf6",
  value: "#e5e7eb",
};

function seededRandom(seed) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function particleTriangle(cx, baseY, size, count = 420) {
  const rand = seededRandom(42);
  let dots = "";
  const apexY = baseY - size;
  for (let i = 0; i < count; i++) {
    // uniform sample inside a triangle via sqrt-trick (apex at top, base at bottom)
    let a = rand(), b = rand();
    if (a + b > 1) { a = 1 - a; b = 1 - b; }
    // barycentric: apex(cx,apexY), baseLeft(cx-size/2,baseY), baseRight(cx+size/2,baseY)
    const px = cx + a * (cx - size / 2 - cx) + b * (cx + size / 2 - cx);
    const py = apexY + a * (baseY - apexY) + b * (baseY - apexY);
    const r = 1 + rand() * 1.6;
    const op = 0.25 + rand() * 0.65;
    const useAccent = rand() > 0.82;
    dots += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r.toFixed(1)}" fill="${useAccent ? COLORS.accent2 : COLORS.accent}" opacity="${op.toFixed(2)}"/>`;
  }
  return dots;
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
}

function systemInfoSVG() {
  const W = 900, H = 480;
  const rows = [
    ["Subject", "Achmad Rizqi Mubarok"],
    ["Role", "Mobile App Developer / Full-Stack Developer"],
    ["Origin", "Surabaya, Indonesia"],
    ["Education", "B.S. Informatics Engineering -- ITATS"],
    ["Status", "Building + Learning + Shipping"],
    ["ToolChain", "VS Code, Git, GitHub Copilot, Figma"],
    ["", ""],
    ["Core.Lang", "TypeScript, PHP, Dart, JavaScript"],
    ["Core.Frontend", "React, Next.js, Tailwind CSS"],
    ["Core.Backend", "Laravel, NestJS, Node.js"],
    ["Core.Database", "PostgreSQL, Prisma, Supabase"],
    ["Core.Infra", "Vercel, Docker, GitHub Actions"],
    ["", ""],
    ["Grid.Mail", "achmadriskim07@gmail.com"],
    ["Grid.Portfolio", "pacoel-dev-folio.lovable.app"],
    ["Grid.LinkedIn", "ahmad-rizqi-mubarok-4b4598376"],
    ["Grid.GitHub", "@MasRizqi07"],
    ["Grid.Instagram", "@pacoel.dev"],
  ];

  const rightX = 470;
  const lineH = 20.5;
  const topY = 108;
  let rowsSvg = "";
  rows.forEach(([k, v], i) => {
    if (!k) return;
    const y = topY + i * lineH;
    const dots = ".".repeat(Math.max(2, 28 - k.length));
    rowsSvg += `
      <text x="${rightX}" y="${y}" font-family="JetBrains Mono, monospace" font-size="12.5" fill="${COLORS.key}">${escapeXml(k)}</text>
      <text x="${rightX + k.length * 7.3 + 4}" y="${y}" font-family="JetBrains Mono, monospace" font-size="12.5" fill="${COLORS.dim}">${dots}</text>
      <text x="${W - 40}" y="${y}" text-anchor="end" font-family="JetBrains Mono, monospace" font-size="12.5" fill="${COLORS.value}">${escapeXml(v)}</text>`;
  });

  const triCx = 235, triBaseY = 380, triSize = 250;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <clipPath id="rounded"><rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="14"/></clipPath>
  </defs>
  <rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="14" fill="${COLORS.bg}" stroke="${COLORS.border}" stroke-width="1.5"/>
  <g clip-path="url(#rounded)">
    <rect x="0" y="0" width="${W}" height="42" fill="${COLORS.panel}"/>
    <line x1="0" y1="42" x2="${W}" y2="42" stroke="${COLORS.border}" stroke-width="1"/>
    <circle cx="26" cy="21" r="6" fill="#ff5f56"/>
    <circle cx="46" cy="21" r="6" fill="#ffbd2e"/>
    <circle cx="66" cy="21" r="6" fill="#27c93f"/>
    <text x="90" y="26" font-family="JetBrains Mono, monospace" font-size="13" fill="${COLORS.dim}">achmadriskim07@gmail.com -- % ./profile.sh --live</text>
    <circle cx="${W - 90}" cy="21" r="4" fill="#27c93f">
      <animate attributeName="opacity" values="1;0.25;1" dur="1.6s" repeatCount="indefinite"/>
    </circle>
    <text x="${W - 78}" y="25" font-family="JetBrains Mono, monospace" font-size="11" fill="#27c93f" letter-spacing="1">LIVE</text>

    <text x="40" y="76" font-family="JetBrains Mono, monospace" font-size="12" fill="${COLORS.accent2}" letter-spacing="2">VISUAL.MAP</text>
    ${particleTriangle(triCx, triBaseY, triSize)}

    <line x1="420" y1="60" x2="420" y2="${H - 30}" stroke="${COLORS.border}" stroke-width="1"/>

    <text x="${rightX}" y="76" font-family="JetBrains Mono, monospace" font-size="12" fill="${COLORS.accent2}" letter-spacing="2">SYSTEM.INFO</text>

    ${rowsSvg}

    <text x="40" y="${H - 22}" font-family="JetBrains Mono, monospace" font-size="12" fill="${COLORS.dim}">&gt; More about me &amp; projects below in README</text>
    <rect x="322" y="${H - 32}" width="8" height="14" fill="${COLORS.accent2}">
      <animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite"/>
    </rect>
  </g>
</svg>`;
}

function statsBricksSVG(data) {
  const W = 900, H = 150;
  const boxW = (W - 40) / 3;
  const box = (x, title, big, sub) => `
    <g>
      <rect x="${x}" y="0" width="${boxW - 10}" height="${H}" rx="12" fill="${COLORS.panel}" stroke="${COLORS.border}" stroke-width="1.5"/>
      <text x="${x + (boxW - 10) / 2}" y="60" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="34" font-weight="700" fill="${COLORS.accent2}">${big}</text>
      <text x="${x + (boxW - 10) / 2}" y="88" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="12" fill="${COLORS.text}" letter-spacing="1">${title}</text>
      <text x="${x + (boxW - 10) / 2}" y="108" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="10.5" fill="${COLORS.dim}">${sub}</text>
    </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  ${box(0, "TOTAL CONTRIBUTIONS", data.totalContributions, `${data.contributionRangeStart} - Present`)}
  ${box(boxW + 15, "CURRENT STREAK 🔥", data.currentStreak, data.currentStreakRange)}
  ${box((boxW + 15) * 2, "LONGEST STREAK", data.longestStreak, data.longestStreakRange)}
</svg>`;
}

function projectsGridSVG() {
  const W = 900;
  const cardW = (W - 30) / 2;
  const cardH = 108;
  const gap = 15;
  const cols = 2;

  let cards = "";
  PROJECTS.forEach((p, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * (cardW + gap);
    const y = row * (cardH + gap);
    const tags = p.stack
      .map((t, ti) => {
        const tagW = t.length * 6.2 + 16;
        const tagX = 16 + p.stack.slice(0, ti).reduce((a, s) => a + s.length * 6.2 + 16 + 6, 0);
        return `<rect x="${tagX}" y="${cardH - 30}" width="${tagW}" height="18" rx="9" fill="${COLORS.bg}" stroke="${COLORS.border}"/>
                <text x="${tagX + tagW / 2}" y="${cardH - 17}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="9.5" fill="${COLORS.accent2}">${escapeXml(t)}</text>`;
      })
      .join("");

    cards += `
      <g transform="translate(${x},${y})">
        <rect x="0" y="0" width="${cardW}" height="${cardH}" rx="10" fill="${COLORS.panel}" stroke="${COLORS.border}" stroke-width="1.5"/>
        <circle cx="${cardW - 22}" cy="22" r="9" fill="none" stroke="#27c93f" stroke-width="2"/>
        <path d="M ${cardW - 26} 22 l 2.5 3 l 5 -6" stroke="#27c93f" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="16" y="26" font-family="JetBrains Mono, monospace" font-size="14" font-weight="700" fill="${COLORS.value}">${escapeXml(p.name)}_</text>
        <text x="16" y="46" font-family="JetBrains Mono, monospace" font-size="10.5" fill="${COLORS.dim}">${escapeXml(p.desc)}</text>
        ${tags}
      </g>`;
  });

  const rowsCount = Math.ceil(PROJECTS.length / cols);
  const headerH = 34;
  const H = headerH + rowsCount * cardH + (rowsCount - 1) * gap;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <text x="0" y="16" font-family="JetBrains Mono, monospace" font-size="12" fill="${COLORS.accent2}" letter-spacing="2">PROJECTS.LIST  ./projects.sh --all</text>
  <g transform="translate(0,${headerH})">
  ${cards}
  </g>
</svg>`;
}

async function main() {
  mkdirSync("assets", { recursive: true });

  let live = null;
  try {
    live = await fetchLiveData();
  } catch (err) {
    console.error("Unexpected error during live fetch -- using fallback:", err.message);
  }
  const data = live || FALLBACK;
  if (!live) console.log("No live data used -- using last-known-real fallback snapshot.");

  writeFileSync("assets/system-info.svg", systemInfoSVG());
  writeFileSync("assets/stats-bricks.svg", statsBricksSVG(data));
  writeFileSync("assets/projects-grid.svg", projectsGridSVG());

  console.log("Generated: assets/system-info.svg, assets/stats-bricks.svg, assets/projects-grid.svg");
  console.log("Data used:", data);
}

main().catch((err) => {
  // Last-resort safety net: never let the workflow fail red because of a
  // data-fetch problem -- the cards should still exist with fallback data.
  console.error("main() failed unexpectedly:", err);
  process.exitCode = 0;
});
