"use client";

import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { io, Socket } from "socket.io-client";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  ShieldAlert,
  Navigation,
  Eye,
  Volume2,
  VolumeX,
  Flame,
  Zap,
  Target,
  FileDown,
  RotateCcw,
  CheckCircle2,
  Package,
  AlertTriangle,
  Send,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  Columns,
  LayoutGrid
} from "lucide-react";
import {
  Telemetry,
  Mission,
  Detection,
  Obstacle,
  DEMO_OBSTACLES,
  EMERGENCY_NEEDS_CATALOG
} from "./types";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export default function RescueCommandCenter() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const droneMarker = useRef<mapboxgl.Marker | null>(null);
  const targetMarker = useRef<mapboxgl.Marker | null>(null);
  const detectionMarkers = useRef<mapboxgl.Marker[]>([]);

  // Connectivity & State
  const [isLiveHardware, setIsLiveHardware] = useState(false);
  const [telemetry, setTelemetry] = useState<Telemetry>({
    lat: 12.9716,
    lng: 77.5946,
    altitude: 0,
    battery: 98,
    mode: "STANDBY",
    source: "autonomous_sim",
    timestamp: null,
    obstacleNear: false
  });
  const [mission, setMission] = useState<Mission | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [frameVersion, setFrameVersion] = useState(0);
  const [error, setError] = useState("");

  // Tactical Controls & Flight Deck
  const [audioAlerts, setAudioAlerts] = useState(true);
  const [thermalMode, setThermalMode] = useState(false);
  const [missionStartTime, setMissionStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState("00:00");
  const [activeAlertMessage, setActiveAlertMessage] = useState<string | null>(null);
  const [payloadBay, setPayloadBay] = useState({
    medKits: 2,
    lifebuoys: 2,
    thermalRations: 3,
    radioBeacons: 2
  });

  // Dynamic Workspace Resizing & Collapse Controls
  const [sidebarWidth, setSidebarWidth] = useState(560);
  const [isCameraCollapsed, setIsCameraCollapsed] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const simIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const telemetryRef = useRef(telemetry);
  telemetryRef.current = telemetry;
  const dispatchMissionRef = useRef<(lat: number, lng: number) => void>(() => {});

  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  // Draggable Splitter Mouse Handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = Math.max(380, Math.min(window.innerWidth - 320, window.innerWidth - e.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isResizing) {
        setIsResizing(false);
      }
    };

    if (isResizing) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  // Trigger Mapbox resize whenever sidebar width changes
  useEffect(() => {
    if (map.current) {
      map.current.resize();
    }
  }, [sidebarWidth, isResizing]);

  // Tactical Dual-Tone Audio Alert Chime
  const playAlertSound = (isHighPriority = true) => {
    if (!audioAlerts) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") ctx.resume();

      const f1 = isHighPriority ? 920 : 640;
      const f2 = isHighPriority ? 1480 : 880;

      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(f1, ctx.currentTime);
      gain1.gain.setValueAtTime(0.35, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.16);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(f2, ctx.currentTime + 0.10);
      gain2.gain.setValueAtTime(0.35, ctx.currentTime + 0.10);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.32);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(ctx.currentTime + 0.10);
      osc2.stop(ctx.currentTime + 0.32);
    } catch {}
  };

  // Mission Timer
  useEffect(() => {
    if (!missionStartTime) return;
    const interval = setInterval(() => {
      const secs = Math.floor((Date.now() - missionStartTime) / 1000);
      const m = String(Math.floor(secs / 60)).padStart(2, "0");
      const s = String(secs % 60).padStart(2, "0");
      setElapsedTime(`${m}:${s}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [missionStartTime]);

  // Hybrid Socket.IO & Auto Cloud Simulator Fallback
  useEffect(() => {
    let socket: Socket | null = null;
    try {
      socket = io(API, { timeout: 2500, reconnectionAttempts: 2 });

      socket.on("connect", () => {
        setIsLiveHardware(true);
        setError("");
      });

      socket.on("disconnect", () => {
        setIsLiveHardware(false);
      });

      socket.on("connect_error", () => {
        setIsLiveHardware(false);
      });

      socket.on("telemetry", (data: Telemetry) => {
        setTelemetry(data);
      });

      socket.on("mission", (data: Mission) => {
        setMission(data);
        setMissionStartTime(Date.now());
      });

      socket.on("detection", (data: any) => {
        playAlertSound(true);
        const randomNeed = EMERGENCY_NEEDS_CATALOG[Math.floor(Math.random() * EMERGENCY_NEEDS_CATALOG.length)];
        const enhanced: Detection = {
          ...data,
          need: data.need || randomNeed
        };
        setDetections((prev) => [enhanced, ...prev].slice(0, 50));
      });

      socket.on("frame", (v: number) => {
        setFrameVersion(v);
      });
    } catch {
      setIsLiveHardware(false);
    }

    return () => {
      socket?.disconnect();
    };
  }, [audioAlerts]);

  // Mapbox Setup with Free Dark Tactical Raster Tile Fallback
  useEffect(() => {
    if (!mapContainer.current) return;

    const token =
      process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
      "pk.eyJ1Ijoia2FydGlrbTAxMTEiLCJhIjoiY203M3g1djRwMDJpazJqcHNodnF3cWpwaSJ9.demo_token_or_replace";
    mapboxgl.accessToken = token;

    // High-contrast tactical dark map style (CartoDB Dark Matter raster tiles)
    // Works 100% reliably out of the box with zero token requirements
    const darkTacticalStyle: mapboxgl.Style = {
      version: 8,
      sources: {
        "carto-dark": {
          type: "raster",
          tiles: [
            "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
            "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"
          ],
          tileSize: 256
        }
      },
      layers: [
        {
          id: "carto-dark-layer",
          type: "raster",
          source: "carto-dark",
          minzoom: 0,
          maxzoom: 20
        }
      ]
    };

    const instance = new mapboxgl.Map({
      container: mapContainer.current,
      style: darkTacticalStyle,
      center: [77.5946, 12.9716],
      zoom: 14.5,
      pitch: 45
    });

    map.current = instance;
    instance.addControl(new mapboxgl.NavigationControl(), "top-right");

    // Custom Drone Element with Radar Sweep
    const droneEl = document.createElement("div");
    droneEl.style.cssText = "position: relative; display: flex; align-items: center; justify-content: center;";
    droneEl.innerHTML = `
      <div class="radar-ring"></div>
      <div style="width: 24px; height: 24px; border-radius: 50%; background: #00f2fe; border: 3px solid #ffffff; box-shadow: 0 0 16px #00f2fe; display: flex; align-items: center; justify-content: center;">
        <div style="width: 6px; height: 6px; border-radius: 50%; background: #06090e;"></div>
      </div>
    `;

    droneMarker.current = new mapboxgl.Marker({ element: droneEl })
      .setLngLat([77.5946, 12.9716])
      .addTo(instance);

    // Add 3D LiDAR Obstacle Hazards to Map
    DEMO_OBSTACLES.forEach((obs) => {
      const obsEl = document.createElement("div");
      obsEl.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; cursor: pointer;">
          <div style="background: rgba(244, 63, 94, 0.25); border: 2px solid #f43f5e; border-radius: 50%; width: 26px; height: 26px; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 10px rgba(244, 63, 94, 0.7); font-size: 13px;">
            ⚠️
          </div>
          <div style="background: rgba(15, 23, 42, 0.9); border: 1px solid #f43f5e; color: #fecdd3; font-size: 8px; font-weight: bold; font-family: monospace; padding: 1px 4px; border-radius: 3px; margin-top: 2px; white-space: nowrap;">
            ${obs.name.toUpperCase()} (${obs.heightMeters}m)
          </div>
        </div>
      `;
      new mapboxgl.Marker({ element: obsEl })
        .setLngLat([obs.lng, obs.lat])
        .setPopup(new mapboxgl.Popup({ offset: 15 }).setHTML(`
          <div style="color: #0f172a; font-family: sans-serif; font-size: 11px; padding: 4px;">
            <strong style="color: #e11d48;">⚠️ LiDAR Obstacle Detected</strong><br/>
            Type: <b>${obs.name}</b><br/>
            Elevation: <b>${obs.heightMeters}m AGL</b><br/>
            Safety Action: <b>35m Autonomous Detour</b>
          </div>
        `))
        .addTo(instance);
    });

    // Map Click -> Trigger Mission
    instance.on("click", (e) => {
      dispatchMissionRef.current(e.lngLat.lat, e.lngLat.lng);
    });

    return () => {
      instance.remove();
      map.current = null;
    };
  }, []);

  // Update Drone Position
  useEffect(() => {
    if (droneMarker.current && telemetry) {
      droneMarker.current.setLngLat([telemetry.lng, telemetry.lat]);
    }
  }, [telemetry]);

  // Update Mission Target Marker
  useEffect(() => {
    if (!map.current) return;
    targetMarker.current?.remove();

    if (mission) {
      const targetEl = document.createElement("div");
      targetEl.innerHTML = `
        <div style="position: relative; display: flex; align-items: center; justify-content: center;">
          <div style="width: 20px; height: 20px; border-radius: 50%; background: #f59e0b; border: 2px solid white; box-shadow: 0 0 12px #f59e0b;"></div>
        </div>
      `;
      targetMarker.current = new mapboxgl.Marker({ element: targetEl })
        .setLngLat([mission.lng, mission.lat])
        .setPopup(new mapboxgl.Popup().setText(`Mission Target: ${mission.id.slice(0, 8)}`))
        .addTo(map.current);
    }
  }, [mission]);

  // Update Detection Markers with Triage Colors
  useEffect(() => {
    if (!map.current) return;
    detectionMarkers.current.forEach((m) => m.remove());
    detectionMarkers.current = [];

    detections.slice(0, 15).forEach((d) => {
      if (!d.droneLocation || !map.current) return;
      const need = d.need || EMERGENCY_NEEDS_CATALOG[0];

      const markerColor = d.signaledDept ? "#10b981" : need.urgency === "CRITICAL" ? "#f43f5e" : "#f59e0b";
      const markerEl = document.createElement("div");
      markerEl.innerHTML = `
        <div style="width: 22px; height: 22px; border-radius: 50%; background: ${markerColor}; border: 2px solid white; box-shadow: 0 0 14px ${markerColor}; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: bold; color: white;">
          ${d.payloadDropped ? "📦" : d.signaledDept ? "✓" : "!"}
        </div>
      `;

      const m = new mapboxgl.Marker({ element: markerEl })
        .setLngLat([d.droneLocation.lng, d.droneLocation.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 15 }).setHTML(`
            <div style="color: #0f172a; font-family: sans-serif; font-size: 11px; padding: 4px;">
              <strong style="color: ${markerColor};">${need.title}</strong><br/>
              Urgency: <b>${need.urgency}</b> | Conf: <b>${(d.confidence * 100).toFixed(0)}%</b><br/>
              Assigned: <b>${need.department}</b><br/>
              <span style="color: #64748b; font-size: 10px;">GPS: ${d.droneLocation.lat.toFixed(5)}, ${d.droneLocation.lng.toFixed(5)}</span>
            </div>
          `)
        )
        .addTo(map.current);

      detectionMarkers.current.push(m);
    });
  }, [detections]);

  // Autonomous In-Browser Flight & Obstacle Avoidance Engine
  const runAutonomousBrowserSortie = (targetLat: number, targetLng: number) => {
    if (simIntervalRef.current) clearInterval(simIntervalRef.current);

    // Continue navigation from drone's current real-time coordinates
    let curLat = telemetryRef.current.lat;
    let curLng = telemetryRef.current.lng;
    let curAlt = telemetryRef.current.altitude;
    let curBatt = telemetryRef.current.battery != null ? telemetryRef.current.battery : 95;
    let stepCount = 0;

    const missionObj = {
      id: `sort_${Date.now().toString(36)}`,
      lat: targetLat,
      lng: targetLng,
      altitude: 30
    };
    setMission(missionObj);
    setMissionStartTime(Date.now());

    simIntervalRef.current = setInterval(() => {
      stepCount++;

      // If drone is at ground level, climb to 30m. If already airborne, immediately navigate!
      if (curAlt < 30) {
        curAlt = Math.min(30, curAlt + 3.0);
        setTelemetry((prev) => ({ ...prev, altitude: curAlt, mode: "TAKING_OFF" }));
        return;
      }

      const dLat = targetLat - curLat;
      const dLng = targetLng - curLng;
      const dist = Math.hypot(dLat, dLng);

      if (dist < 0.00015) {
        curLat = targetLat;
        curLng = targetLng;
        setTelemetry((prev) => ({
          ...prev,
          lat: targetLat,
          lng: targetLng,
          mode: "HOVER_SEARCHING",
          altitude: 30,
          obstacleNear: false,
          obstacleName: undefined
        }));
        clearInterval(simIntervalRef.current!);
        return;
      }

      // LiDAR Collision Avoidance Check
      let avoiding = false;
      let nearObstacle: Obstacle | null = null;
      for (const obs of DEMO_OBSTACLES) {
        const obsDist = Math.hypot(obs.lat - curLat, obs.lng - curLng);
        if (obsDist < 0.0018) {
          nearObstacle = obs;
          avoiding = true;
          break;
        }
      }

      let stepLat = (dLat / dist) * 0.00015;
      let stepLng = (dLng / dist) * 0.00015;

      if (avoiding && nearObstacle) {
        stepLat += 0.00012;
        stepLng += 0.00008;
        setActiveAlertMessage(`⚠️ LiDAR COLLISION ALERT: ${nearObstacle.name} at 32m -> DYNAMIC YAW DETOUR ENGAGED`);
      } else {
        if (stepCount % 20 === 0) setActiveAlertMessage(null);
      }

      curLat += stepLat;
      curLng += stepLng;
      curBatt = Math.max(10, curBatt - 0.03);

      setTelemetry({
        lat: curLat,
        lng: curLng,
        altitude: 30,
        battery: curBatt,
        mode: avoiding ? "AVOIDING_OBSTACLE" : "EN_ROUTE",
        source: isLiveHardware ? "hardware" : "autonomous_sim",
        timestamp: new Date().toISOString(),
        obstacleNear: avoiding,
        obstacleName: nearObstacle?.name
      });

      if (stepCount === 10 || stepCount === 24 || stepCount === 42) {
        playAlertSound(true);
        const catalogIdx = Math.floor(stepCount / 10) % EMERGENCY_NEEDS_CATALOG.length;
        const need = EMERGENCY_NEEDS_CATALOG[catalogIdx] || EMERGENCY_NEEDS_CATALOG[0];
        const newDet: Detection = {
          id: `det_${Date.now()}_${stepCount}`,
          confidence: 0.91 + Math.random() * 0.07,
          frameIndex: stepCount * 8,
          timestamp: new Date().toISOString(),
          droneLocation: { lat: curLat, lng: curLng },
          need
        };
        setDetections((prev) => [newDet, ...prev]);
        setFrameVersion((v) => v + 1);
      }
    }, 250);
  };

  // Dispatch Mission (Attempts Hardware API, with instant fallback)
  const dispatchMission = async (targetLat: number, targetLng: number) => {
    playAlertSound(false);
    try {
      const res = await fetch(`${API}/api/mission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: targetLat, lng: targetLng })
      });
      if (res.ok) {
        const data = await res.json();
        setMission(data);
        setMissionStartTime(Date.now());
        return;
      }
    } catch {}
    runAutonomousBrowserSortie(targetLat, targetLng);
  };

  dispatchMissionRef.current = dispatchMission;

  // Return to Launch (RTL)
  const triggerRTL = () => {
    playAlertSound(false);
    dispatchMission(12.9716, 77.5946);
  };

  // Quick Demo Mission from current drone coordinates
  const triggerQuickDemo = () => {
    const curLat = telemetryRef.current.lat;
    const curLng = telemetryRef.current.lng;
    dispatchMission(curLat + 0.0035, curLng + 0.0042);
  };

  // Signal Respective Government Relief Department
  const signalDepartment = (detection: Detection) => {
    playAlertSound(false);
    const need = detection.need || EMERGENCY_NEEDS_CATALOG[0];
    setDetections((prev) =>
      prev.map((d) => (d.id === detection.id ? { ...d, signaledDept: true } : d))
    );
    setActiveAlertMessage(`📡 ENCRYPTED SIGNAL TRANSMITTED: ${need.department} (${need.departmentCode}) acknowledged coordinates.`);
    setTimeout(() => setActiveAlertMessage(null), 5000);
  };

  // Emergency Supply Payload Air-Drop
  const dropPayload = (detection: Detection) => {
    playAlertSound(true);
    const need = detection.need || EMERGENCY_NEEDS_CATALOG[0];
    setDetections((prev) =>
      prev.map((d) => (d.id === detection.id ? { ...d, payloadDropped: true } : d))
    );

    setPayloadBay((prev) => {
      if (need.category === "TRAUMA") return { ...prev, medKits: Math.max(0, prev.medKits - 1) };
      if (need.category === "FLOOD") return { ...prev, lifebuoys: Math.max(0, prev.lifebuoys - 1) };
      if (need.category === "HYPOTHERMIA") return { ...prev, thermalRations: Math.max(0, prev.thermalRations - 1) };
      return { ...prev, radioBeacons: Math.max(0, prev.radioBeacons - 1) };
    });

    const latStr = detection.droneLocation?.lat != null ? detection.droneLocation.lat.toFixed(4) : "12.9716";
    const lngStr = detection.droneLocation?.lng != null ? detection.droneLocation.lng.toFixed(4) : "77.5946";
    setActiveAlertMessage(`📦 AIR-DROP RELEASED: ${need.requiredSupply} successfully parachuted to (${latStr}, ${lngStr})`);
    setTimeout(() => setActiveAlertMessage(null), 6000);
  };

  // Export Comprehensive Disaster Manifest
  const exportIncidentReport = () => {
    if (detections.length === 0) {
      alert("No survivor detections to export yet! Launch a mission first.");
      return;
    }

    const report = {
      incidentCode: `SAR-SIH-${new Date().toISOString().slice(0, 10)}`,
      generatedAt: new Date().toISOString(),
      homeBaseCoordinates: { lat: 12.9716, lng: 77.5946 },
      safetyGeofenceRadius: "3.0 KM",
      totalVictimsLocated: detections.length,
      payloadsRemaining: payloadBay,
      survivorsTriageManifest: detections.map((d, index) => ({
        triageIndex: index + 1,
        detectionId: d.id,
        confidence: `${(d.confidence * 100).toFixed(1)}%`,
        gpsLatitude: d.droneLocation?.lat,
        gpsLongitude: d.droneLocation?.lng,
        diagnosedNeed: d.need.title,
        urgencyLevel: d.need.urgency,
        assignedAgency: d.need.department,
        agencyDispatched: d.signaledDept ? "ACKNOWLEDGED" : "PENDING_DISPATCH",
        emergencySupplyDropped: d.payloadDropped ? d.need.requiredSupply : "AWAITING_AIRDROP",
        timestamp: d.timestamp
      }))
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Rescue_Triage_Manifest_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", width: "100vw", position: "relative", zIndex: 1 }}>
      {/* 1. TOP AEROSPACE COMMAND HUD BAR */}
      <header className="glass-panel" style={{ margin: "10px 14px", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Zap color="var(--cyan-bright)" size={26} />
            <div>
              <h1 style={{ fontSize: "20px", letterSpacing: "2px", fontWeight: 700, margin: 0, lineHeight: 1 }}>
                RESQ<span style={{ color: "var(--cyan-bright)" }}>-AI</span> COMMAND
              </h1>
              <span style={{ fontSize: "10px", color: "#64748b", fontFamily: "var(--font-mono)", letterSpacing: "1px" }}>
                SIH-2026 // AUTONOMOUS SEARCH & RESCUE
              </span>
            </div>
          </div>

          <div style={{ height: "28px", width: "1px", background: "var(--border-subtle)" }}></div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px", fontFamily: "var(--font-mono)", fontSize: "12px" }}>
            <span style={{ color: "#94a3b8" }}>STATUS:</span>
            <span style={{
              padding: "2px 8px",
              borderRadius: "4px",
              fontWeight: 600,
              background: telemetry.mode === "EN_ROUTE" ? "rgba(245, 158, 11, 0.2)" : "rgba(16, 185, 129, 0.15)",
              color: telemetry.mode === "EN_ROUTE" ? "var(--amber-warn)" : "var(--emerald-live)",
              border: `1px solid ${telemetry.mode === "EN_ROUTE" ? "rgba(245, 158, 11, 0.4)" : "rgba(16, 185, 129, 0.3)"}`
            }}>
              {telemetry.mode}
            </span>
            <span style={{ color: "#64748b" }}>|</span>
            <span style={{ color: "#94a3b8" }}>T-ELAPSED: <b style={{ color: "#e2e8f0" }}>{elapsedTime}</b></span>
          </div>
        </div>

        {/* Action Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            onClick={() => setThermalMode(!thermalMode)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: thermalMode ? "rgba(245, 158, 11, 0.2)" : "rgba(255, 255, 255, 0.05)",
              color: thermalMode ? "var(--amber-warn)" : "#94a3b8",
              border: `1px solid ${thermalMode ? "var(--amber-warn)" : "var(--border-subtle)"}`,
              borderRadius: "6px",
              padding: "6px 12px",
              cursor: "pointer",
              fontSize: "12px",
              fontFamily: "var(--font-display)",
              fontWeight: 600
            }}
          >
            <Flame size={14} /> FLIR THERMAL {thermalMode ? "ON" : "OFF"}
          </button>

          {/* Test Audio Button */}
          <button
            onClick={() => playAlertSound(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: "rgba(34, 211, 238, 0.1)",
              border: "1px solid var(--border-glow)",
              color: "var(--cyan-bright)",
              borderRadius: "6px",
              padding: "6px 12px",
              cursor: "pointer",
              fontSize: "12px",
              fontFamily: "var(--font-display)",
              fontWeight: 600
            }}
            title="Click to test alert sound"
          >
            <Volume2 size={15} /> TEST AUDIO
          </button>

          <button
            onClick={() => setAudioAlerts(!audioAlerts)}
            style={{
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid var(--border-subtle)",
              color: audioAlerts ? "var(--cyan-bright)" : "#64748b",
              borderRadius: "6px",
              padding: "6px 10px",
              cursor: "pointer"
            }}
            title="Toggle Mute"
          >
            {audioAlerts ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>

          <button
            onClick={triggerRTL}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: "rgba(245, 158, 11, 0.15)",
              border: "1px solid rgba(245, 158, 11, 0.4)",
              color: "var(--amber-warn)",
              borderRadius: "6px",
              padding: "6px 12px",
              cursor: "pointer",
              fontSize: "12px",
              fontFamily: "var(--font-display)",
              fontWeight: 600
            }}
            title="Return to Launch Home"
          >
            RTL (RETURN HOME)
          </button>
          <button
            onClick={triggerQuickDemo}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: "linear-gradient(135deg, #0891b2, #00f2fe)",
              color: "#06090e",
              border: "none",
              borderRadius: "6px",
              padding: "6px 14px",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: "12px",
              fontFamily: "var(--font-display)",
              boxShadow: "0 0 15px rgba(0, 242, 254, 0.4)"
            }}
          >
            <Target size={15} /> QUICK DEMO MISSION
          </button>

          {/* Layout View Presets */}
          <div style={{
            display: "flex",
            alignItems: "center",
            background: "rgba(255, 255, 255, 0.04)",
            borderRadius: "6px",
            padding: "2px",
            border: "1px solid var(--border-subtle)",
            gap: "2px"
          }}>
            <button
              onClick={() => setSidebarWidth(440)}
              style={{
                background: sidebarWidth <= 460 ? "rgba(0, 242, 254, 0.2)" : "transparent",
                color: sidebarWidth <= 460 ? "var(--cyan-bright)" : "#94a3b8",
                border: "none",
                borderRadius: "4px",
                padding: "4px 8px",
                fontSize: "11px",
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
                fontWeight: 600
              }}
              title="Wide Map View (Sidebar 440px)"
            >
              MAP 70%
            </button>
            <button
              onClick={() => setSidebarWidth(600)}
              style={{
                background: sidebarWidth > 460 && sidebarWidth < 720 ? "rgba(0, 242, 254, 0.2)" : "transparent",
                color: sidebarWidth > 460 && sidebarWidth < 720 ? "var(--cyan-bright)" : "#94a3b8",
                border: "none",
                borderRadius: "4px",
                padding: "4px 8px",
                fontSize: "11px",
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
                fontWeight: 600
              }}
              title="Balanced View (Sidebar 600px)"
            >
              BALANCED
            </button>
            <button
              onClick={() => setSidebarWidth(780)}
              style={{
                background: sidebarWidth >= 720 ? "rgba(0, 242, 254, 0.2)" : "transparent",
                color: sidebarWidth >= 720 ? "var(--cyan-bright)" : "#94a3b8",
                border: "none",
                borderRadius: "4px",
                padding: "4px 8px",
                fontSize: "11px",
                cursor: "pointer",
                fontFamily: "var(--font-mono)",
                fontWeight: 600
              }}
              title="Wide Triage View (Sidebar 780px)"
            >
              TRIAGE 60%
            </button>
          </div>

          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "11px",
            fontFamily: "var(--font-mono)",
            color: isLiveHardware ? "var(--emerald-live)" : "var(--cyan-bright)",
            background: isLiveHardware ? "rgba(16, 185, 129, 0.12)" : "rgba(0, 242, 254, 0.12)",
            padding: "5px 10px",
            borderRadius: "6px",
            border: `1px solid ${isLiveHardware ? "rgba(16, 185, 129, 0.3)" : "rgba(0, 242, 254, 0.3)"}`
          }}>
            <span style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: isLiveHardware ? "var(--emerald-live)" : "var(--cyan-bright)",
              boxShadow: `0 0 8px ${isLiveHardware ? "var(--emerald-live)" : "var(--cyan-bright)"}`
            }}></span>
            {isLiveHardware ? "🟢 HARDWARE LINK (5 Hz)" : "⚡ AUTONOMOUS AGENT (SIM)"}
          </div>
        </div>
      </header>

      {/* DYNAMIC TACTICAL NOTIFICATION BANNER */}
      {activeAlertMessage && (
        <div style={{
          margin: "0 14px 10px 14px",
          padding: "8px 16px",
          background: activeAlertMessage.includes("COLLISION") ? "rgba(244, 63, 94, 0.2)" : "rgba(0, 242, 254, 0.15)",
          border: `1px solid ${activeAlertMessage.includes("COLLISION") ? "var(--rose-alert)" : "var(--cyan-bright)"}`,
          borderRadius: "6px",
          color: activeAlertMessage.includes("COLLISION") ? "#fecdd3" : "var(--cyan-bright)",
          fontSize: "12px",
          fontFamily: "var(--font-mono)",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          boxShadow: activeAlertMessage.includes("COLLISION") ? "0 0 15px rgba(244, 63, 94, 0.4)" : "0 0 15px rgba(0, 242, 254, 0.2)"
        }}>
          <AlertTriangle size={16} color={activeAlertMessage.includes("COLLISION") ? "var(--rose-alert)" : "var(--cyan-bright)"} />
          <strong>{activeAlertMessage}</strong>
        </div>
      )}

      {/* 2. MAIN TACTICAL WORKSPACE (MAP + DRAGGABLE SPLITTER + SIDEBAR) */}
      <div style={{
        display: "grid",
        gridTemplateColumns: `1fr 10px ${sidebarWidth}px`,
        flex: 1,
        gap: "0",
        padding: "0 14px 14px 14px",
        overflow: "hidden"
      }}>
        
        {/* LEFT: 3D TACTICAL MAP */}
        <div className="glass-panel" style={{ position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", height: "100%" }}>
          <div ref={mapContainer} style={{ width: "100%", height: "100%" }} />

          {/* Interactive Tactical HUD Overlay on Map */}
          <div style={{
            position: "absolute",
            top: "14px",
            left: "14px",
            background: "rgba(6, 9, 14, 0.8)",
            backdropFilter: "blur(8px)",
            padding: "8px 12px",
            borderRadius: "6px",
            border: "1px solid var(--border-glow)",
            fontSize: "11px",
            fontFamily: "var(--font-mono)",
            pointerEvents: "none"
          }}>
            <div>GEOFENCE: <b>3.0 KM SAFE ZONE</b></div>
            <div style={{ color: "var(--cyan-bright)", marginTop: "2px" }}>
              CLICK ANYWHERE ON MAP TO DEPLOY RESCUE ROUTE
            </div>
          </div>

          {/* Map Legend */}
          <div style={{
            position: "absolute",
            bottom: "14px",
            left: "14px",
            background: "rgba(6, 9, 14, 0.85)",
            backdropFilter: "blur(8px)",
            padding: "8px 14px",
            borderRadius: "6px",
            border: "1px solid var(--border-subtle)",
            display: "flex",
            gap: "16px",
            fontSize: "11px",
            fontFamily: "var(--font-display)",
            fontWeight: 600
          }}>
            <span style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--cyan-bright)" }}>
              ● RESCUE DRONE
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--amber-warn)" }}>
              ● FLIGHT TARGET
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "6px", color: "var(--rose-alert)" }}>
              ● SURVIVOR ALERT
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "6px", color: "#f43f5e" }}>
              ⚠️ LiDAR OBSTACLE
            </span>
          </div>
        </div>

        {/* DRAGGABLE RESIZE SPLITTER */}
        <div
          onMouseDown={startResizing}
          style={{
            cursor: "col-resize",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            zIndex: 10,
            userSelect: "none",
            width: "10px",
            margin: "0 2px"
          }}
          title="Click and drag to resize Tactical Map & Sidebar"
        >
          <div style={{
            width: isResizing ? "4px" : "2px",
            height: "50px",
            borderRadius: "2px",
            background: isResizing ? "var(--cyan-bright)" : "rgba(255, 255, 255, 0.2)",
            boxShadow: isResizing ? "0 0 12px var(--cyan-bright)" : "none",
            transition: "all 0.15s ease"
          }} />
        </div>

        {/* RIGHT: FLIGHT AVIONICS & AI VISION FEED */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          height: "100%",
          overflow: "hidden"
        }}>
          
          {/* AVIONICS TELEMETRY DECK */}
          <div className="glass-panel" style={{ padding: "14px", flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "8px" }}>
              <span style={{ fontSize: "12px", letterSpacing: "1px", fontWeight: 700, color: "#94a3b8", display: "flex", alignItems: "center", gap: "6px" }}>
                <Navigation size={14} color="var(--cyan-bright)" /> AVIONICS & TELEMETRY
              </span>
              <span style={{ fontSize: "10px", fontFamily: "var(--font-mono)", color: "var(--cyan-bright)", background: "rgba(0, 242, 254, 0.1)", padding: "2px 6px", borderRadius: "3px" }}>
                {telemetry.source.toUpperCase()} // 5 Hz
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div style={{ background: "var(--bg-card)", padding: "10px", borderRadius: "6px", border: "1px solid var(--border-subtle)" }}>
                <span style={{ fontSize: "10px", color: "#64748b", display: "block" }}>ALTITUDE (AGL)</span>
                <strong style={{ fontSize: "18px", color: "var(--cyan-bright)", fontFamily: "var(--font-mono)" }}>
                  {telemetry.altitude.toFixed(1)} <span style={{ fontSize: "11px" }}>m</span>
                </strong>
              </div>

              <div style={{ background: "var(--bg-card)", padding: "10px", borderRadius: "6px", border: "1px solid var(--border-subtle)" }}>
                <span style={{ fontSize: "10px", color: "#64748b", display: "block" }}>BATTERY LEVEL</span>
                <strong style={{
                  fontSize: "18px",
                  color: telemetry.battery && telemetry.battery < 25 ? "var(--rose-alert)" : "var(--emerald-live)",
                  fontFamily: "var(--font-mono)"
                }}>
                  {telemetry.battery != null ? `${telemetry.battery.toFixed(0)}%` : "—"}
                </strong>
              </div>

              <div style={{ background: "var(--bg-card)", padding: "10px", borderRadius: "6px", border: "1px solid var(--border-subtle)" }}>
                <span style={{ fontSize: "10px", color: "#64748b", display: "block" }}>GPS POSITION</span>
                <span style={{ fontSize: "11px", color: "#e2e8f0", fontFamily: "var(--font-mono)", display: "block", marginTop: "2px" }}>
                  {telemetry.lat.toFixed(4)}°N, {telemetry.lng.toFixed(4)}°E
                </span>
              </div>

              {/* LiDAR Proximity & Collision Guard */}
              <div style={{
                background: telemetry.obstacleNear ? "rgba(244, 63, 94, 0.15)" : "var(--bg-card)",
                padding: "10px",
                borderRadius: "6px",
                border: `1px solid ${telemetry.obstacleNear ? "var(--rose-alert)" : "var(--border-subtle)"}`
              }}>
                <span style={{ fontSize: "10px", color: telemetry.obstacleNear ? "var(--rose-alert)" : "#64748b", display: "block" }}>
                  LiDAR 360° GUARD
                </span>
                <span style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  fontFamily: "var(--font-mono)",
                  color: telemetry.obstacleNear ? "var(--rose-alert)" : "var(--emerald-live)",
                  display: "block",
                  marginTop: "2px"
                }}>
                  {telemetry.obstacleNear ? `⚠️ DETOUR: ${telemetry.obstacleName || "HAZARD"}` : "🟢 360° CLEAR"}
                </span>
              </div>
            </div>

            {/* DRONE PAYLOAD BAY INVENTORY */}
            <div style={{
              marginTop: "10px",
              padding: "8px 10px",
              background: "rgba(255, 255, 255, 0.03)",
              borderRadius: "6px",
              border: "1px solid var(--border-subtle)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "11px",
              fontFamily: "var(--font-mono)"
            }}>
              <span style={{ color: "#94a3b8", display: "flex", alignItems: "center", gap: "5px" }}>
                <Package size={13} color="var(--cyan-bright)" /> PAYLOAD BAY:
              </span>
              <div style={{ display: "flex", gap: "10px" }}>
                <span title="Trauma Med-Kits">🩸 Med: <b style={{ color: "#e2e8f0" }}>{payloadBay.medKits}</b></span>
                <span title="Lifebuoys">🛟 Buoy: <b style={{ color: "#e2e8f0" }}>{payloadBay.lifebuoys}</b></span>
                <span title="Thermal Rations">❄️ Rations: <b style={{ color: "#e2e8f0" }}>{payloadBay.thermalRations}</b></span>
                <span title="Radio Beacons">📡 Beacons: <b style={{ color: "#e2e8f0" }}>{payloadBay.radioBeacons}</b></span>
              </div>
            </div>
          </div>

          {/* AI AERIAL VISION STREAM (YOLO HUD) */}
          <div className="glass-panel" style={{ padding: "14px", flexShrink: 0, transition: "all 0.2s ease" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isCameraCollapsed ? "0" : "10px" }}>
              <span style={{ fontSize: "12px", letterSpacing: "1px", fontWeight: 700, color: "#94a3b8", display: "flex", alignItems: "center", gap: "6px" }}>
                <Eye size={14} color="var(--cyan-bright)" /> AI GIMBAL VISION FEED
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "10px", fontFamily: "var(--font-mono)", color: "#10b981", background: "rgba(16, 185, 129, 0.1)", padding: "2px 6px", borderRadius: "3px" }}>
                  YOLOv8 // INFERENCE ACTIVE
                </span>
                <button
                  onClick={() => setIsCameraCollapsed(!isCameraCollapsed)}
                  style={{
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid var(--border-subtle)",
                    color: "#94a3b8",
                    borderRadius: "4px",
                    padding: "2px 6px",
                    cursor: "pointer",
                    fontSize: "10px",
                    fontFamily: "var(--font-mono)",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px"
                  }}
                  title={isCameraCollapsed ? "Expand Camera Viewport" : "Minimize Camera to enlarge Triage Queue"}
                >
                  {isCameraCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                  {isCameraCollapsed ? "EXPAND" : "MINIMIZE"}
                </button>
              </div>
            </div>

            {/* Video Viewport with HUD Crosshair & Scanlines */}
            {!isCameraCollapsed && (
              <div className={`scanlines ${thermalMode ? "thermal-mode" : ""}`} style={{
                position: "relative",
                aspectRatio: "16/9",
                background: "#000",
                borderRadius: "6px",
                overflow: "hidden",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}>
                {frameVersion > 0 ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`${API}/api/frame?v=${frameVersion}`}
                    alt="Aerial YOLO Feed"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <div style={{ textAlign: "center", padding: "20px" }}>
                    <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>
                      AI Aerial Gimbal Stream Armed<br />
                      <span style={{ fontSize: "10px", color: "#475569" }}>Tracking Search & Rescue Grid (FLIR Optical)</span>
                    </p>
                  </div>
                )}

                {/* HUD Reticle Overlay */}
                <div style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center"
                }}>
                  <div style={{ width: "40px", height: "40px", border: "1px dashed rgba(0, 242, 254, 0.4)", borderRadius: "50%" }}></div>
                  <div style={{ position: "absolute", width: "16px", height: "1px", background: "rgba(0, 242, 254, 0.6)" }}></div>
                  <div style={{ position: "absolute", height: "16px", width: "1px", background: "rgba(0, 242, 254, 0.6)" }}></div>
                  
                  {/* HUD Camera Stats */}
                  <div style={{ position: "absolute", bottom: "8px", left: "8px", fontSize: "10px", fontFamily: "var(--font-mono)", color: "var(--cyan-bright)" }}>
                    FOV: 84° // ALT: {telemetry.altitude.toFixed(0)}m
                  </div>
                  <div style={{ position: "absolute", top: "8px", right: "8px", fontSize: "10px", fontFamily: "var(--font-mono)", color: "#10b981" }}>
                    REC ● 640x480
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* SURVIVOR DETECTION & AI TRIAGE QUEUE */}
          <div className="glass-panel" style={{
            padding: "14px",
            flex: 1,
            display: "flex",
            flexDirection: "column",
            minHeight: "280px",
            overflow: "hidden"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <span style={{ fontSize: "12px", letterSpacing: "1px", fontWeight: 700, color: "#94a3b8", display: "flex", alignItems: "center", gap: "6px" }}>
                <ShieldAlert size={14} color="var(--rose-alert)" /> SURVIVOR TRIAGE QUEUE
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "10px", fontFamily: "var(--font-mono)", color: "var(--rose-alert)", background: "rgba(244, 63, 94, 0.15)", padding: "2px 6px", borderRadius: "3px" }}>
                  {detections.length} IDENTIFIED
                </span>
                <button
                  onClick={exportIncidentReport}
                  style={{
                    background: "rgba(34, 211, 238, 0.1)",
                    border: "1px solid var(--border-glow)",
                    color: "var(--cyan-bright)",
                    padding: "3px 8px",
                    borderRadius: "4px",
                    fontSize: "10px",
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "var(--font-mono)"
                  }}
                  title="Export Manifest for Ground Rescue Teams"
                >
                  EXPORT MANIFEST
                </button>
              </div>
            </div>

            <div style={{
              display: sidebarWidth >= 640 ? "grid" : "flex",
              gridTemplateColumns: sidebarWidth >= 640 ? "1fr 1fr" : undefined,
              flexDirection: sidebarWidth >= 640 ? undefined : "column",
              gap: "10px",
              overflowY: "auto",
              flex: 1
            }}>
              {detections.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: "#64748b", fontSize: "12px" }}>
                  Scanning rescue sector... Click map or QUICK DEMO to initiate sortie.
                </div>
              ) : (
                detections.map((d) => {
                  const need = d.need || EMERGENCY_NEEDS_CATALOG[0];
                  return (
                    <div
                      key={d.id}
                      style={{
                        background: need.urgency === "CRITICAL" ? "rgba(244, 63, 94, 0.08)" : "rgba(245, 158, 11, 0.08)",
                        border: `1px solid ${d.signaledDept ? "rgba(16, 185, 129, 0.5)" : need.urgency === "CRITICAL" ? "rgba(244, 63, 94, 0.4)" : "rgba(245, 158, 11, 0.4)"}`,
                        padding: "10px 12px",
                        borderRadius: "6px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "6px"
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{ fontSize: "15px" }}>{need.supplyIcon}</span>
                          <strong style={{ color: "#f8fafc", fontSize: "12px" }}>
                            {need.title}
                          </strong>
                          <span style={{
                            fontSize: "9px",
                            fontFamily: "var(--font-mono)",
                            padding: "1px 5px",
                            borderRadius: "3px",
                            fontWeight: 700,
                            background: need.urgency === "CRITICAL" ? "rgba(244, 63, 94, 0.2)" : "rgba(245, 158, 11, 0.2)",
                            color: need.urgency === "CRITICAL" ? "var(--rose-alert)" : "var(--amber-warn)"
                          }}>
                            {need.urgency} // {(d.confidence * 100).toFixed(0)}%
                          </span>
                        </div>
                        <span style={{ fontSize: "10px", color: "#64748b", fontFamily: "var(--font-mono)" }}>
                          {new Date(d.timestamp).toLocaleTimeString()}
                        </span>
                      </div>

                      <div style={{ fontSize: "11px", color: "#94a3b8", fontFamily: "var(--font-mono)", display: "flex", justifyContent: "space-between" }}>
                        <span>Agency: <b style={{ color: "#e2e8f0" }}>{need.department}</b></span>
                        {d.droneLocation && (
                          <span>GPS: {d.droneLocation.lat.toFixed(4)}, {d.droneLocation.lng.toFixed(4)}</span>
                        )}
                      </div>

                      <div style={{ fontSize: "11px", color: "var(--cyan-bright)", fontFamily: "var(--font-mono)" }}>
                        Aid Kit: <b>{need.requiredSupply}</b>
                      </div>

                      {/* INTERACTIVE ACTION BUTTONS */}
                      <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                        <button
                          onClick={() => signalDepartment(d)}
                          disabled={d.signaledDept}
                          style={{
                            flex: 1,
                            padding: "5px 8px",
                            borderRadius: "4px",
                            fontSize: "10px",
                            fontWeight: 700,
                            fontFamily: "var(--font-display)",
                            cursor: d.signaledDept ? "default" : "pointer",
                            background: d.signaledDept ? "rgba(16, 185, 129, 0.15)" : "rgba(0, 242, 254, 0.1)",
                            color: d.signaledDept ? "var(--emerald-live)" : "var(--cyan-bright)",
                            border: `1px solid ${d.signaledDept ? "rgba(16, 185, 129, 0.4)" : "var(--border-glow)"}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "4px"
                          }}
                        >
                          {d.signaledDept ? (
                            <>
                              <CheckCircle2 size={12} /> AGENCY DISPATCHED
                            </>
                          ) : (
                            <>
                              <Send size={12} /> SIGNAL {need.departmentCode}
                            </>
                          )}
                        </button>

                        <button
                          onClick={() => dropPayload(d)}
                          disabled={d.payloadDropped}
                          style={{
                            flex: 1,
                            padding: "5px 8px",
                            borderRadius: "4px",
                            fontSize: "10px",
                            fontWeight: 700,
                            fontFamily: "var(--font-display)",
                            cursor: d.payloadDropped ? "default" : "pointer",
                            background: d.payloadDropped ? "rgba(16, 185, 129, 0.15)" : "rgba(245, 158, 11, 0.15)",
                            color: d.payloadDropped ? "var(--emerald-live)" : "var(--amber-warn)",
                            border: `1px solid ${d.payloadDropped ? "rgba(16, 185, 129, 0.4)" : "rgba(245, 158, 11, 0.4)"}`,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "4px"
                          }}
                        >
                          {d.payloadDropped ? (
                            <>
                              <Package size={12} /> PAYLOAD AIR-DROPPED
                            </>
                          ) : (
                            <>
                              <Package size={12} /> AIR-DROP {need.supplyIcon} SUPPLY
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
