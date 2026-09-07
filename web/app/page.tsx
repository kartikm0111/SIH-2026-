"use client";

import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { io } from "socket.io-client";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  ShieldAlert,
  Navigation,
  Eye,
  Volume2,
  VolumeX,
  Flame,
  Zap,
  Target
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

type Telemetry = {
  lat: number;
  lng: number;
  altitude: number;
  battery: number | null;
  mode: string;
  source: string;
  timestamp: string | null;
};

type Mission = {
  id: string;
  lat: number;
  lng: number;
  altitude: number;
};

type Detection = {
  id: string;
  confidence: number;
  frameIndex: number;
  timestamp: string;
  droneLocation: { lat: number; lng: number } | null;
};

type Snapshot = {
  telemetry: Telemetry;
  mission: Mission | null;
  detections: Detection[];
  frameVersion: number;
};

export default function RescueCommandCenter() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const droneMarker = useRef<mapboxgl.Marker | null>(null);
  const targetMarker = useRef<mapboxgl.Marker | null>(null);
  const detectionMarkers = useRef<mapboxgl.Marker[]>([]);

  // Telemetry & State
  const [connected, setConnected] = useState(false);
  const [telemetry, setTelemetry] = useState<Telemetry>({
    lat: 12.9716,
    lng: 77.5946,
    altitude: 0,
    battery: 98,
    mode: "STANDBY",
    source: "mock",
    timestamp: null
  });
  const [mission, setMission] = useState<Mission | null>(null);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [frameVersion, setFrameVersion] = useState(0);
  const [error, setError] = useState("");

  // Tactical Controls
  const [audioAlerts, setAudioAlerts] = useState(true);
  const [thermalMode, setThermalMode] = useState(false);
  const [missionStartTime, setMissionStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState("00:00");
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Tactical Dual-Tone Audio Alert Chime (Aerospace Alert Tone)
  const playAlertSound = () => {
    if (!audioAlerts) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioCtx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") {
        ctx.resume();
      }

      // First beep (880 Hz - High pitch alert)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(880, ctx.currentTime);
      gain1.gain.setValueAtTime(0.4, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.18);

      // Second beep (1320 Hz - Affirmative lock tone)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(1320, ctx.currentTime + 0.12);
      gain2.gain.setValueAtTime(0.4, ctx.currentTime + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.38);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(ctx.currentTime + 0.12);
      osc2.stop(ctx.currentTime + 0.38);
    } catch {
      // Audio context policy
    }
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

  // Socket Connection
  useEffect(() => {
    const socket = io(API, { reconnectionAttempts: 5 });

    socket.on("connect", () => {
      setConnected(true);
      setError("");
    });

    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => {
      setConnected(false);
      setError("Waiting for backend API on 127.0.0.1:4000...");
    });

    socket.on("state", (state: Snapshot) => {
      setTelemetry(state.telemetry);
      setMission(state.mission);
      setDetections(state.detections);
      setFrameVersion(state.frameVersion);
    });

    socket.on("telemetry", (data: Telemetry) => {
      setTelemetry(data);
    });

    socket.on("mission", (data: Mission) => {
      setMission(data);
      setMissionStartTime(Date.now());
    });

    socket.on("detection", (data: Detection) => {
      playAlertSound();
      setDetections((prev) => [data, ...prev].slice(0, 50));
    });

    socket.on("frame", (v: number) => {
      setFrameVersion(v);
    });

    return () => {
      socket.disconnect();
    };
  }, [audioAlerts]);

  // Mapbox Setup with Free Dark Tactical Raster Tile Fallback
  useEffect(() => {
    if (!mapContainer.current) return;

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (token) {
      mapboxgl.accessToken = token;
    }

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

    // Map Click -> Trigger Mission
    instance.on("click", async (e) => {
      try {
        setError("");
        playAlertSound(); // Unlocks browser audio policy on user click
        const res = await fetch(`${API}/api/mission`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: e.lngLat.lat, lng: e.lngLat.lng })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Mission failed");
        setMission(data);
        setMissionStartTime(Date.now());
      } catch (err: any) {
        setError(err.message || "Failed to dispatch mission");
      }
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

  // Update Detection Markers
  useEffect(() => {
    if (!map.current) return;
    detectionMarkers.current.forEach((m) => m.remove());
    detectionMarkers.current = [];

    detections.slice(0, 15).forEach((d) => {
      if (!d.droneLocation || !map.current) return;

      const markerEl = document.createElement("div");
      markerEl.innerHTML = `
        <div style="width: 20px; height: 20px; border-radius: 50%; background: #f43f5e; border: 2px solid white; box-shadow: 0 0 14px #f43f5e; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; color: white;">
          !
        </div>
      `;

      const m = new mapboxgl.Marker({ element: markerEl })
        .setLngLat([d.droneLocation.lng, d.droneLocation.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 15 }).setHTML(`
            <div style="color: #0f172a; font-family: sans-serif; font-size: 12px; padding: 4px;">
              <strong style="color: #e11d48;">SURVIVOR DETECTED</strong><br/>
              Confidence: <b>${(d.confidence * 100).toFixed(1)}%</b><br/>
              Frame: #${d.frameIndex}<br/>
              <span style="font-size: 10px; color: #64748b;">Ref Drone GPS: ${d.droneLocation.lat.toFixed(4)}, ${d.droneLocation.lng.toFixed(4)}</span>
            </div>
          `)
        )
        .addTo(map.current);

      detectionMarkers.current.push(m);
    });
  }, [detections]);

  // Export Incident Report
  const exportIncidentReport = () => {
    if (detections.length === 0) {
      alert("No detections to export yet!");
      return;
    }
    const report = {
      incidentCode: `SAR-SIH-${new Date().toISOString().slice(0, 10)}`,
      generatedAt: new Date().toISOString(),
      homeBase: { lat: 12.9716, lng: 77.5946 },
      totalConfirmedSurvivors: detections.length,
      survivors: detections.map((d, index) => ({
        index: index + 1,
        id: d.id,
        confidence: `${(d.confidence * 100).toFixed(1)}%`,
        gpsLatitude: d.droneLocation?.lat,
        gpsLongitude: d.droneLocation?.lng,
        recordedFrame: d.frameIndex,
        detectedTime: d.timestamp,
        rescueStatus: "DISPATCH_AUTHORIZED"
      }))
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Rescue_Manifest_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Quick Demo Dispatch
  const triggerQuickDemo = async () => {
    try {
      playAlertSound(); // Unlocks audio on user click
      const res = await fetch(`${API}/api/mission`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: telemetry.lat + 0.0025,
          lng: telemetry.lng + 0.003
        })
      });
      const data = await res.json();
      setMission(data);
      setMissionStartTime(Date.now());
    } catch {
      setError("Check backend connectivity.");
    }
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
            onClick={playAlertSound}
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

          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "11px",
            fontFamily: "var(--font-mono)",
            color: connected ? "var(--emerald-live)" : "var(--rose-alert)"
          }}>
            <span style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: connected ? "var(--emerald-live)" : "var(--rose-alert)",
              boxShadow: `0 0 8px ${connected ? "var(--emerald-live)" : "var(--rose-alert)"}`
            }}></span>
            {connected ? "LIVE TELEMETRY" : "OFFLINE"}
          </div>
        </div>
      </header>

      {/* ERROR BANNER */}
      {error && (
        <div style={{
          margin: "0 14px 10px 14px",
          padding: "8px 16px",
          background: "rgba(244, 63, 94, 0.15)",
          border: "1px solid var(--rose-alert)",
          borderRadius: "6px",
          color: "var(--rose-alert)",
          fontSize: "12px",
          fontFamily: "var(--font-mono)"
        }}>
          ⚠️ {error}
        </div>
      )}

      {/* 2. MAIN TACTICAL WORKSPACE (MAP + SIDEBAR) */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 440px", flex: 1, gap: "14px", padding: "0 14px 14px 14px", overflow: "hidden" }}>
        
        {/* LEFT: 3D TACTICAL MAP */}
        <div className="glass-panel" style={{ position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }}>
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
          </div>
        </div>

        {/* RIGHT: FLIGHT AVIONICS & AI VISION FEED */}
        <div style={{ display: "flex", flexDirection: "column", gap: "14px", overflowY: "auto", maxHeight: "calc(100vh - 100px)" }}>
          
          {/* AVIONICS TELEMETRY DECK */}
          <div className="glass-panel" style={{ padding: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "8px" }}>
              <span style={{ fontSize: "12px", letterSpacing: "1px", fontWeight: 700, color: "#94a3b8", display: "flex", alignItems: "center", gap: "6px" }}>
                <Navigation size={14} color="var(--cyan-bright)" /> AVIONICS & TELEMETRY
              </span>
              <span style={{ fontSize: "10px", fontFamily: "var(--font-mono)", color: "var(--cyan-bright)", background: "rgba(0, 242, 254, 0.1)", padding: "2px 6px", borderRadius: "3px" }}>
                {telemetry.source.toUpperCase()} // 5 Hz
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
              <div style={{ background: "var(--bg-card)", padding: "10px", borderRadius: "6px", border: "1px solid var(--border-subtle)" }}>
                <span style={{ fontSize: "10px", color: "#64748b", display: "block" }}>ALTITUDE (AGL)</span>
                <strong style={{ fontSize: "20px", color: "var(--cyan-bright)", fontFamily: "var(--font-mono)" }}>
                  {telemetry.altitude.toFixed(1)} <span style={{ fontSize: "11px" }}>m</span>
                </strong>
              </div>

              <div style={{ background: "var(--bg-card)", padding: "10px", borderRadius: "6px", border: "1px solid var(--border-subtle)" }}>
                <span style={{ fontSize: "10px", color: "#64748b", display: "block" }}>BATTERY LEVEL</span>
                <strong style={{
                  fontSize: "20px",
                  color: telemetry.battery && telemetry.battery < 25 ? "var(--rose-alert)" : "var(--emerald-live)",
                  fontFamily: "var(--font-mono)"
                }}>
                  {telemetry.battery != null ? `${telemetry.battery.toFixed(0)}%` : "—"}
                </strong>
              </div>

              <div style={{ background: "var(--bg-card)", padding: "10px", borderRadius: "6px", border: "1px solid var(--border-subtle)" }}>
                <span style={{ fontSize: "10px", color: "#64748b", display: "block" }}>COORDINATES</span>
                <span style={{ fontSize: "11px", color: "#e2e8f0", fontFamily: "var(--font-mono)", display: "block", marginTop: "4px" }}>
                  {telemetry.lat.toFixed(4)}°N<br />{telemetry.lng.toFixed(4)}°E
                </span>
              </div>
            </div>
          </div>

          {/* AI AERIAL VISION STREAM (YOLO HUD) */}
          <div className="glass-panel" style={{ padding: "14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <span style={{ fontSize: "12px", letterSpacing: "1px", fontWeight: 700, color: "#94a3b8", display: "flex", alignItems: "center", gap: "6px" }}>
                <Eye size={14} color="var(--cyan-bright)" /> AI GIMBAL VISION FEED
              </span>
              <span style={{ fontSize: "10px", fontFamily: "var(--font-mono)", color: "#10b981", background: "rgba(16, 185, 129, 0.1)", padding: "2px 6px", borderRadius: "3px" }}>
                YOLOv8 // INFERENCE ACTIVE
              </span>
            </div>

            {/* Video Viewport with HUD Crosshair & Scanlines */}
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
                    Awaiting Vision Worker Stream...<br />
                    <span style={{ fontSize: "10px", color: "#475569" }}>Run `python vision.py` in workers/</span>
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
          </div>

          {/* SURVIVOR DETECTION QUEUE */}
          <div className="glass-panel" style={{ padding: "14px", flex: 1, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <span style={{ fontSize: "12px", letterSpacing: "1px", fontWeight: 700, color: "#94a3b8", display: "flex", alignItems: "center", gap: "6px" }}>
                <ShieldAlert size={14} color="var(--rose-alert)" /> SURVIVOR DETECTION QUEUE
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "10px", fontFamily: "var(--font-mono)", color: "var(--rose-alert)", background: "rgba(244, 63, 94, 0.15)", padding: "2px 6px", borderRadius: "3px" }}>
                  {detections.length} CONFIRMED
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

            <div style={{ display: "flex", flexDirection: "column", gap: "8px", overflowY: "auto", maxHeight: "200px" }}>
              {detections.length === 0 ? (
                <div style={{ textAlign: "center", padding: "24px 0", color: "#64748b", fontSize: "12px" }}>
                  Scanning search sector... No survivor signatures detected.
                </div>
              ) : (
                detections.map((d) => (
                  <div
                    key={d.id}
                    className="alert-pulse"
                    style={{
                      background: "rgba(244, 63, 94, 0.08)",
                      border: "1px solid rgba(244, 63, 94, 0.4)",
                      padding: "10px 12px",
                      borderRadius: "6px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center"
                    }}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <strong style={{ color: "var(--rose-alert)", fontSize: "13px" }}>
                          SURVIVOR CONFIRMED ({(d.confidence * 100).toFixed(0)}%)
                        </strong>
                        <span style={{ fontSize: "10px", color: "#94a3b8", fontFamily: "var(--font-mono)" }}>
                          Frame #{d.frameIndex}
                        </span>
                      </div>
                      {d.droneLocation && (
                        <span style={{ fontSize: "11px", color: "#cbd5e1", fontFamily: "var(--font-mono)" }}>
                          REF: {d.droneLocation.lat.toFixed(5)}°N, {d.droneLocation.lng.toFixed(5)}°E
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: "10px", color: "#64748b", fontFamily: "var(--font-mono)" }}>
                      {new Date(d.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
