import express from "express";
import cors from "cors";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);

const port = Number(process.env.PORT || 4000);
const origin = process.env.WEB_ORIGIN || "http://localhost:3000";
const workerToken = process.env.WORKER_TOKEN;

if (!workerToken) {
  throw new Error("WORKER_TOKEN is required");
}

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

app.use(cors({ origin: "*" }));

const home = {
  lat: Number(process.env.START_LAT || 12.9716),
  lng: Number(process.env.START_LNG || 77.5946),
};

let telemetry = {
  ...home,
  altitude: 0,
  battery: 100,
  mode: "IDLE",
  source: "mock",
  timestamp: null,
};

let mission = null;
let detections = [];
let frame = null;
let frameVersion = 0;

const validNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

const validCoordinates = (lat, lng) =>
  validNumber(lat) &&
  validNumber(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180;

function distanceMeters(a, b) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.lat)) *
      Math.cos(radians(b.lat)) *
      Math.sin(dLng / 2) ** 2;

  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function requireWorker(req, res, next) {
  if (req.get("x-worker-token") !== workerToken) {
    return res.status(401).json({ error: "Unauthorized worker" });
  }
  next();
}

function snapshot() {
  return { telemetry, mission, detections, frameVersion };
}

io.on("connection", (socket) => {
  socket.emit("state", snapshot());
});

// Register binary ingestion separately from JSON parsing.
app.post(
  "/api/frame",
  requireWorker,
  express.raw({ type: "image/jpeg", limit: "2mb" }),
  (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "JPEG body required" });
    }

    frame = req.body;
    frameVersion += 1;

    io.emit("frame", frameVersion);
    res.sendStatus(204);
  }
);

app.use(express.json({ limit: "100kb" }));

app.get("/health", (_, res) => {
  res.json({ ok: true, service: "resq-ai-api" });
});

app.get("/api/state", (_, res) => {
  res.json(snapshot());
});

app.get("/api/mission", (_, res) => {
  res.json({ mission });
});

app.get("/api/frame", (_, res) => {
  if (!frame) {
    return res.status(404).send("No video frame yet");
  }

  res.set("Content-Type", "image/jpeg");
  res.set("Cache-Control", "no-store");
  res.send(frame);
});

app.post("/api/mission", (req, res) => {
  const { lat, lng } = req.body;

  if (!validCoordinates(lat, lng)) {
    return res.status(400).json({ error: "Invalid coordinates" });
  }

  if (distanceMeters(home, { lat, lng }) > 3000) {
    return res.status(400).json({
      error: "Choose a destination within 3 km of the starting point.",
    });
  }

  mission = {
    id: randomUUID(),
    lat,
    lng,
    altitude: 30,
    createdAt: new Date().toISOString(),
  };

  // Avoid displaying a previous mission's image as the new feed.
  frame = null;
  frameVersion = 0;
  io.emit("frame", frameVersion);

  io.emit("mission", mission);
  res.status(201).json(mission);
});

app.post("/api/telemetry", requireWorker, (req, res) => {
  const data = req.body;

  if (
    !validCoordinates(data.lat, data.lng) ||
    !validNumber(data.altitude) ||
    data.altitude < -10 ||
    data.altitude > 1000 ||
    !(
      data.battery === null ||
      (validNumber(data.battery) &&
        data.battery >= 0 &&
        data.battery <= 100)
    ) ||
    !["mock", "sitl"].includes(data.source) ||
    typeof data.mode !== "string"
  ) {
    return res.status(400).json({ error: "Invalid telemetry" });
  }

  telemetry = {
    lat: data.lat,
    lng: data.lng,
    altitude: data.altitude,
    battery: data.battery,
    mode: data.mode.slice(0, 40),
    source: data.source,
    timestamp: new Date().toISOString(),
  };

  io.emit("telemetry", telemetry);
  res.sendStatus(204);
});

app.post("/api/detections", requireWorker, (req, res) => {
  const { confidence, frameIndex, box, missionId } = req.body;

  if (
    !mission ||
    missionId !== mission.id ||
    !validNumber(confidence) ||
    confidence < 0 ||
    confidence > 1 ||
    !Number.isInteger(frameIndex) ||
    frameIndex < 0 ||
    !Array.isArray(box) ||
    box.length !== 4 ||
    !box.every(validNumber)
  ) {
    return res.status(400).json({ error: "Invalid detection" });
  }

  const freshTelemetry =
    telemetry.timestamp &&
    Date.now() - Date.parse(telemetry.timestamp) < 5000;

  const detection = {
    id: randomUUID(),
    missionId,
    label: "person",
    confidence,
    frameIndex,
    box,
    timestamp: new Date().toISOString(),

    // This is NOT an estimated person's position.
    droneLocation: freshTelemetry
      ? { lat: telemetry.lat, lng: telemetry.lng }
      : null,

    locationSource: "demo-drone-reference",
  };

  detections = [detection, ...detections].slice(0, 50);

  io.emit("detection", detection);
  res.status(201).json(detection);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`RESQ-AI API running at http://127.0.0.1:${port}`);
});
