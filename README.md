# RESQ-AI: Autonomous Drone Search & Rescue Command Center 🚁🚨
### Smart India Hackathon (SIH 2026)

RESQ-AI is a full-stack, real-time command center for autonomous search and rescue (SAR) operations. It coordinates drone navigation, streams live aerial video feeds, executes real-time YOLO human detection, and plots incident locations on an interactive 3D tactical map with audio alert triggers.

---

## 🌟 Architecture & Demo Flow
```text
  [ Interactive Mapbox Dashboard ] (Next.js 14 / App Router)
                 │
                 ├── POST /api/mission (Dispatch Destination) ───┐
                 │                                               ▼
                 │                                      [ Express Gateway ] 
                 │                                    (HTTP + Socket.IO Server)
                 │                                               ▲
                 │                                               │ HTTP Ingestion
                 │                                     ┌─────────┴─────────┐
                 │                                     │                   │
                 ▼                              [ Flight Worker ]   [ Vision Worker ]
        [ Socket.IO Events ]                      (Sim / SITL)      (YOLOv8 Aerial)
  (Telemetry, Detections, Frames)
```

1. **Mission Dispatch**: Click any coordinate on the tactical 3D map (geofenced to 3 km safe zone).
2. **Autonomous Navigation**: The simulated drone climbs to cruising altitude (30m) and travels toward the target.
3. **Aerial AI Vision**: YOLOv8 performs real-time human detection inference on aerial video frames.
4. **Live Command HUD**: The dashboard receives high-frequency telemetry, live annotated video, FLIR thermal toggles, and audio-chime alerts for confirmed survivor coordinates.

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Node.js**: v20+ or v22+
- **Python**: 3.10+ / 3.11+ / 3.12+

### 2. Backend API Setup
```bash
cd api
npm install
node --env-file=../.env server.mjs
```
*Runs on `http://127.0.0.1:4000`*

### Fast offline rehearsal

Do this once while you have an internet connection, then the demo itself needs no network:

```powershell
Copy-Item .env.example .env
# Set a non-empty WORKER_TOKEN in .env
cd web; npm install; cd ..
python -m venv .venv
.\.venv\Scripts\python -m pip install -r workers\requirements.txt
```

After that, double-click `start_demo.bat`. It opens the API gateway, 5 Hz flight worker, local YOLO worker, and Next.js command center. The tactical map uses local vector overlays rather than online map tiles, while the vision worker automatically generates a credible aerial feed when a video file is unavailable.

### 3. Next.js Command Center Frontend
```bash
cd web
npm install
npm run dev
```
*Open `http://localhost:3000`*

### 4. Python Workers
```bash
cd workers
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

pip install -r requirements.txt

# Terminal A - Start Flight Simulator:
python flight.py

# Terminal B - Start YOLO Aerial Vision:
python vision.py --video ../assets/aerial.mp4 --confidence 0.65
```

---

## 🛡️ Key Features
- **Avionics Flight Deck**: Altitude AGL, ground speed, battery discharge monitoring, and GPS coordinates.
- **FLIR Thermal Vision Simulation**: 1-click infrared contrast filter for nighttime disaster simulation.
- **Acoustic Warning System**: Real-time synthesized tactical beep on survivor detection (Web Audio API).
- **Safe-Fail Geofencing**: Built-in 3km perimeter limits to avoid flyaway scenarios.
- **Fail-Safe Demo Button**: Quick 1-click mission launch button for uninterrupted live pitching.
- **Offline Operations Map**: Local grid, safety geofence, drone, target, hazard, and survivor overlays remain operational without external map tiles.
- **Mission Safety API**: Gateway-enforced 3 km geofence, explicit RTL command, abort state, `/health` observability, and a machine-readable manifest endpoint.

---

## Judge-ready technical notes

**30-second positioning:** RESQ-AI turns a drone into an edge-operated search-and-rescue unit: a local Python YOLOv8 worker identifies people from camera frames, while a Node.js gateway streams telemetry and annotated frames to a tactical web command center. Operators can dispatch a geofenced sortie, triage detected survivors, coordinate relief agencies, and export a structured handover manifest. Because RESQ-AI runs entirely on edge hardware and standard web protocols, it can be deployed on locally assembled, low-cost drones rather than requiring expensive proprietary enterprise hardware.

**Why the 5 Hz stream stays responsive:** telemetry is small JSON and is relayed asynchronously through Socket.IO; JPEG frames are accepted separately as bounded binary requests and exposed as a cache-free latest-frame endpoint. The gateway retains only the newest frame instead of queueing video, so a slow browser cannot cause inference or flight control backpressure. `/health` reports received telemetry, detection, and frame counters during the demo.

**Safe demo sequence:** Start the four local services, wait for `API GATEWAY ONLINE`, click within the cyan 3 km geofence (or use Quick Demo), show the flight/vision/triage updates, signal an agency, optionally air-drop an aid kit, then export the manifest. Use RTL to return home; use the abort endpoint for a controlled hold if required.
