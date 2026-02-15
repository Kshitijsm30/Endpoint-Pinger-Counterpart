require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const ENV_URL = process.env.URL;
const CSV_FILE = path.join(__dirname, "..", "urls.csv");

// ── Middleware ───────────────────────────────────────────────
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "..", "public")));

// Log every incoming request with method, path, IP, and response status
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
    console.log(
      `[REQ] ${req.method} ${req.originalUrl} <- ${ip} -> ${res.statusCode} (${duration}ms)`
    );
  });
  next();
});

// Assign a unique user ID cookie on first visit
app.use((req, res, next) => {
  if (!req.cookies.userId) {
    res.cookie("userId", crypto.randomUUID(), {
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
      httpOnly: false,
    });
  }
  next();
});

// ── CSV helpers ─────────────────────────────────────────────
// CSV format:  id,url,userId,createdAt
function ensureCSV() {
  if (!fs.existsSync(CSV_FILE)) {
    fs.writeFileSync(CSV_FILE, "id,url,userId,createdAt\n", "utf-8");
  }
}

function readEntries() {
  ensureCSV();
  const lines = fs
    .readFileSync(CSV_FILE, "utf-8")
    .split("\n")
    .filter((l) => l.trim() !== "");
  // skip header
  return lines.slice(1).map((line) => {
    const [id, url, userId, createdAt] = line.split(",");
    return { id, url, userId, createdAt };
  });
}

function writeEntries(entries) {
  const header = "id,url,userId,createdAt\n";
  const rows = entries
    .map((e) => `${e.id},${e.url},${e.userId},${e.createdAt}`)
    .join("\n");
  fs.writeFileSync(CSV_FILE, header + rows + "\n", "utf-8");
}

// ── API Routes ──────────────────────────────────────────────

// GET /api/urls — returns only the URLs added by the current user
app.get("/api/urls", (req, res) => {
  const userId = req.cookies.userId;
  if (!userId) return res.json([]);
  const entries = readEntries().filter((e) => e.userId === userId);
  res.json(entries);
});

// POST /api/urls — add a new URL
app.post("/api/urls", (req, res) => {
  const userId = req.cookies.userId;
  const { url } = req.body;

  if (!userId) return res.status(401).json({ error: "No user cookie found" });
  if (!url || typeof url !== "string")
    return res.status(400).json({ error: "Invalid URL" });

  try {
    new URL(url); // validate
  } catch {
    return res.status(400).json({ error: "Malformed URL" });
  }

  const entry = {
    id: crypto.randomUUID(),
    url: url.trim(),
    userId,
    createdAt: new Date().toISOString(),
  };

  const entries = readEntries();
  entries.push(entry);
  writeEntries(entries);

  // start pinging this new URL immediately
  schedulePing(entry.url);

  res.status(201).json(entry);
});

// DELETE /api/urls/:id — delete a URL (only if it belongs to the user)
app.delete("/api/urls/:id", (req, res) => {
  const userId = req.cookies.userId;
  const { id } = req.params;

  let entries = readEntries();
  const target = entries.find((e) => e.id === id);

  if (!target) return res.status(404).json({ error: "Entry not found" });
  if (target.userId !== userId)
    return res.status(403).json({ error: "Not your entry" });

  entries = entries.filter((e) => e.id !== id);
  writeEntries(entries);

  // stop pinging this URL if nobody else has it and it's not the env URL
  const stillExists = entries.some((e) => e.url === target.url);
  if (!stillExists && target.url !== ENV_URL) cancelPing(target.url);

  res.json({ message: "Deleted" });
});

// ── Pinger ──────────────────────────────────────────────────
const activeTimers = new Map(); // url -> timeoutId

function getRandomInterval() {
  // 4–6 minutes in ms
  return Math.floor(Math.random() * (360000 - 240000 + 1)) + 240000;
}

async function pingOnce(url) {
  try {
    const res = await fetch(url);
    console.log(`[PING] ${url} -> ${res.status}`);
  } catch (err) {
    console.error(`[PING FAIL] ${url} -> ${err.message}`);
  }
}

function schedulePing(url) {
  if (activeTimers.has(url)) return;

  async function loop() {
    await pingOnce(url);
    const next = getRandomInterval();
    const timer = setTimeout(loop, next);
    activeTimers.set(url, timer);
  }

  loop();
}

function cancelPing(url) {
  const timer = activeTimers.get(url);
  if (timer) {
    clearTimeout(timer);
    activeTimers.delete(url);
  }
}

// On startup, load all unique URLs from CSV and start pinging them
function startAllPingers() {
  const entries = readEntries();
  const uniqueUrls = [...new Set(entries.map((e) => e.url))];
  uniqueUrls.forEach(schedulePing);

  // Always ping the .env URL (mandatory, not shown in frontend)
  if (ENV_URL) {
    schedulePing(ENV_URL);
    console.log(`[ENV] Pinging env URL: ${ENV_URL}`);
  }

  console.log(`[INIT] Pinging ${activeTimers.size} URL(s)`);
}

// ── Start server ────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  ensureCSV();
  startAllPingers();
});
