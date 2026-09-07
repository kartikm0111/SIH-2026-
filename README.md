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
