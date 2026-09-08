"use client";

import React, { useEffect, useRef, useState } from "react";
import { Flame, Eye, Zap, Camera } from "lucide-react";
import { Telemetry, Detection } from "../types";

interface GimbalFeedProps {
  telemetry: Telemetry;
  thermalMode: boolean;
  onToggleThermal: () => void;
  detections: Detection[];
  frameVersion: number;
  apiUrl: string;
}

type VisionMode = "optical" | "thermal" | "nvg";

export default function GimbalFeed({
  telemetry,
  thermalMode,
  onToggleThermal,
  detections,
  frameVersion,
  apiUrl
}: GimbalFeedProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number | null>(null);

  // Vision Mode: optical, thermal (FLIR), nvg (Night Vision)
  const [visionMode, setVisionMode] = useState<VisionMode>(thermalMode ? "thermal" : "optical");
  const [zoomLevel, setZoomLevel] = useState<1 | 2 | 4>(1);
  const [snapshotFlash, setSnapshotFlash] = useState(false);
  const [fps, setFps] = useState(30);

  // Sync prop thermalMode changes to visionMode
  useEffect(() => {
    if (thermalMode && visionMode !== "thermal") {
      setVisionMode("thermal");
    } else if (!thermalMode && visionMode === "thermal") {
      setVisionMode("optical");
    }
  }, [thermalMode]);

  // Handle local vision mode switch
  const handleModeChange = (mode: VisionMode) => {
    setVisionMode(mode);
    if (mode === "thermal" && !thermalMode) {
      onToggleThermal();
    } else if (mode !== "thermal" && thermalMode) {
      onToggleThermal();
    }
  };

  // Terrain and survivor animation tracking
  const stateRef = useRef({
    offsetX: 0,
    offsetY: 0,
    heading: 45,
    pitch: 0,
    roll: 0,
    lastTime: performance.now(),
    survivors: [
      { id: "S1", relX: 0.18, relY: -0.12, temp: 37.2, conf: 0.98, need: "CRITICAL MEDICAL AID" },
      { id: "S2", relX: -0.22, relY: 0.25, temp: 36.8, conf: 0.94, need: "RESCUE BOAT EVAC" },
      { id: "S3", relX: 0.30, relY: 0.22, temp: 35.4, conf: 0.91, need: "FOOD & WATER AID" }
    ]
  });

  // Optional hardware camera frame buffer
  const hwImgRef = useRef<HTMLImageElement | null>(null);
  const hwImgLoadedRef = useRef(false);

  useEffect(() => {
    if (frameVersion > 0 && apiUrl) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        hwImgRef.current = img;
        hwImgLoadedRef.current = true;
      };
      img.onerror = () => {
        hwImgLoadedRef.current = false;
      };
      img.src = `${apiUrl}/api/frame?v=${frameVersion}`;
    }
  }, [frameVersion, apiUrl]);

  // Take recon snapshot
  const triggerSnapshot = () => {
    setSnapshotFlash(true);
    setTimeout(() => setSnapshotFlash(false), 200);
  };

  // Main Canvas Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let isRunning = true;
    let lastFpsUpdate = performance.now();
    let framesThisSecond = 0;

    const render = (now: number) => {
      if (!isRunning) return;

      const delta = Math.min((now - stateRef.current.lastTime) / 1000, 0.1);
      stateRef.current.lastTime = now;

      // Calculate FPS
      framesThisSecond++;
      if (now - lastFpsUpdate >= 1000) {
        setFps(framesThisSecond);
        framesThisSecond = 0;
        lastFpsUpdate = now;
      }

      // Update simulated ground drift based on drone mode & movement
      const isMoving = telemetry.mode === "EN_ROUTE" || telemetry.mode === "AVOIDING_OBSTACLE";
      const speed = isMoving ? 50 * delta : 4 * delta;
      
      // Calculate flight heading angle
      stateRef.current.heading = (stateRef.current.heading + (isMoving ? 0.25 : 0.04)) % 360;
      stateRef.current.pitch = isMoving ? (telemetry.obstacleNear ? -8 : -3) : Math.sin(now * 0.001) * 1.5;
      stateRef.current.roll = telemetry.obstacleNear ? 14 : Math.sin(now * 0.0008) * 2.5;

      const rad = (stateRef.current.heading * Math.PI) / 180;
      stateRef.current.offsetX += Math.sin(rad) * speed;
      stateRef.current.offsetY += Math.cos(rad) * speed;

      const width = canvas.width;
      const height = canvas.height;

      ctx.save();
      ctx.clearRect(0, 0, width, height);

      // --- 1. BASE FEED / TERRAIN RENDERING ---
      if (hwImgLoadedRef.current && hwImgRef.current) {
        if (visionMode === "thermal") {
          ctx.filter = "contrast(180%) brightness(110%) hue-rotate(190deg) saturate(280%)";
        } else if (visionMode === "nvg") {
          ctx.filter = "sepia(100%) hue-rotate(90deg) brightness(120%) contrast(150%)";
        }
        ctx.drawImage(hwImgRef.current, 0, 0, width, height);
        ctx.filter = "none";
      } else if (visionMode === "thermal") {
        // FLIR Ironbow / Radiometric Thermal Base (Dark Indigo -> Violet -> Amber)
        const bgGrad = ctx.createLinearGradient(0, 0, width, height);
        bgGrad.addColorStop(0, "#080417");
        bgGrad.addColorStop(0.5, "#180d38");
        bgGrad.addColorStop(1, "#0d0622");
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);

        // Cool thermal features: River / Flood Waters (12°C - 16°C, deep cold indigo)
        ctx.save();
        ctx.beginPath();
        const waterOffset = (stateRef.current.offsetY * 0.8) % (height * 1.5);
        ctx.moveTo(0, height * 0.45 + Math.sin(now * 0.001) * 15 - waterOffset);
        ctx.bezierCurveTo(
          width * 0.3, height * 0.3 - waterOffset,
          width * 0.7, height * 0.7 - waterOffset,
          width, height * 0.5 - waterOffset
        );
        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.closePath();
        ctx.fillStyle = "rgba(10, 25, 60, 0.85)";
        ctx.fill();
        ctx.restore();

        // Thermal terrain elevation contours & heat radiating structures
        ctx.lineWidth = 1;
        const gridSpacing = 40 * zoomLevel;
        const offX = (stateRef.current.offsetX * zoomLevel) % gridSpacing;
        const offY = (stateRef.current.offsetY * zoomLevel) % gridSpacing;

        ctx.strokeStyle = "rgba(120, 28, 120, 0.22)";
        for (let x = -gridSpacing; x < width + gridSpacing; x += gridSpacing) {
          ctx.beginPath();
          ctx.moveTo(x + offX, 0);
          ctx.lineTo(x + offX, height);
          ctx.stroke();
        }
        for (let y = -gridSpacing; y < height + gridSpacing; y += gridSpacing) {
          ctx.beginPath();
          ctx.moveTo(0, y + offY);
          ctx.lineTo(width, y + offY);
          ctx.stroke();
        }

        // Ruined buildings / concrete debris (warm amber / violet 22°C - 26°C)
        const buildingX = ((width * 0.65 - stateRef.current.offsetX * 0.5) % (width * 1.2) + width * 1.2) % (width * 1.2) - 50;
        const buildingY = ((height * 0.4 - stateRef.current.offsetY * 0.5) % (height * 1.2) + height * 1.2) % (height * 1.2) - 50;
        ctx.fillStyle = "rgba(180, 50, 60, 0.4)";
        ctx.strokeStyle = "rgba(230, 80, 30, 0.7)";
        ctx.fillRect(buildingX, buildingY, 70 * zoomLevel, 45 * zoomLevel);
        ctx.strokeRect(buildingX, buildingY, 70 * zoomLevel, 45 * zoomLevel);

      } else if (visionMode === "nvg") {
        // Night Vision Green Phosphor
        ctx.fillStyle = "#021206";
        ctx.fillRect(0, 0, width, height);

        // NVG Scan noise & terrain
        const gridSpacing = 35 * zoomLevel;
        const offX = (stateRef.current.offsetX * zoomLevel) % gridSpacing;
        const offY = (stateRef.current.offsetY * zoomLevel) % gridSpacing;

        ctx.strokeStyle = "rgba(16, 185, 129, 0.18)";
        for (let x = -gridSpacing; x < width + gridSpacing; x += gridSpacing) {
          ctx.beginPath();
          ctx.moveTo(x + offX, 0);
          ctx.lineTo(x + offX, height);
          ctx.stroke();
        }
        for (let y = -gridSpacing; y < height + gridSpacing; y += gridSpacing) {
          ctx.beginPath();
          ctx.moveTo(0, y + offY);
          ctx.lineTo(width, y + offY);
          ctx.stroke();
        }

        // River in NVG
        ctx.fillStyle = "rgba(6, 40, 15, 0.7)";
        ctx.fillRect(0, height * 0.6, width, height * 0.4);

      } else {
        // RGB Optical Recon View (Disaster Search Grid)
        const bgGrad = ctx.createLinearGradient(0, 0, width, height);
        bgGrad.addColorStop(0, "#0f172a");
        bgGrad.addColorStop(0.5, "#1e293b");
        bgGrad.addColorStop(1, "#090d16");
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);

        // Flooded disaster area river channel
        ctx.save();
        ctx.beginPath();
        const waterOffset = (stateRef.current.offsetY * 0.5) % (height * 1.5);
        ctx.moveTo(0, height * 0.55 - waterOffset);
        ctx.bezierCurveTo(
          width * 0.35, height * 0.4 - waterOffset,
          width * 0.65, height * 0.75 - waterOffset,
          width, height * 0.6 - waterOffset
        );
        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.closePath();
        ctx.fillStyle = "rgba(14, 116, 144, 0.45)";
        ctx.fill();
        ctx.strokeStyle = "rgba(6, 182, 212, 0.5)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        // Roads and satellite grid
        const gridSpacing = 45 * zoomLevel;
        const offX = (stateRef.current.offsetX * zoomLevel) % gridSpacing;
        const offY = (stateRef.current.offsetY * zoomLevel) % gridSpacing;

        ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
        ctx.lineWidth = 1;
        for (let x = -gridSpacing; x < width + gridSpacing; x += gridSpacing) {
          ctx.beginPath();
          ctx.moveTo(x + offX, 0);
          ctx.lineTo(x + offX, height);
          ctx.stroke();
        }
        for (let y = -gridSpacing; y < height + gridSpacing; y += gridSpacing) {
          ctx.beginPath();
          ctx.moveTo(0, y + offY);
          ctx.lineTo(width, y + offY);
          ctx.stroke();
        }

        // Structural footprints / debris field
        const buildingX = ((width * 0.65 - stateRef.current.offsetX * 0.5) % (width * 1.2) + width * 1.2) % (width * 1.2) - 50;
        const buildingY = ((height * 0.4 - stateRef.current.offsetY * 0.5) % (height * 1.2) + height * 1.2) % (height * 1.2) - 50;
        ctx.fillStyle = "rgba(71, 85, 105, 0.4)";
        ctx.strokeStyle = "rgba(148, 163, 184, 0.4)";
        ctx.fillRect(buildingX, buildingY, 65 * zoomLevel, 45 * zoomLevel);
        ctx.strokeRect(buildingX, buildingY, 65 * zoomLevel, 45 * zoomLevel);
      }

      // --- 2. SURVIVOR HEAT SIGNATURES & YOLO OBJECT DETECTIONS ---
      const centerX = width / 2;
      const centerY = height / 2;

      // Track active survivors on the simulated aerial feed
      stateRef.current.survivors.forEach((survivor, idx) => {
        // Relative position with motion
        const sX = centerX + (survivor.relX * width * zoomLevel) + Math.sin(now * 0.0005 + idx) * 8;
        const sY = centerY + (survivor.relY * height * zoomLevel) + Math.cos(now * 0.0005 + idx) * 8;

        if (sX < 30 || sX > width - 30 || sY < 30 || sY > height - 30) return;

        if (visionMode === "thermal") {
          // RADIANT FLIR THERMAL HEAT BLOOM (36.8°C - 37.4°C Human Body Heat)
          const heatRad = ctx.createRadialGradient(sX, sY, 2, sX, sY, 32 * zoomLevel);
          heatRad.addColorStop(0, "#ffffff"); // Core white-hot
          heatRad.addColorStop(0.2, "#fde047"); // Bright yellow
          heatRad.addColorStop(0.45, "#f97316"); // Fire orange
          heatRad.addColorStop(0.75, "#c026d3"); // Thermal magenta
          heatRad.addColorStop(1, "rgba(192, 38, 211, 0)"); // Fade to cool background

          ctx.fillStyle = heatRad;
          ctx.beginPath();
          ctx.arc(sX, sY, 32 * zoomLevel, 0, Math.PI * 2);
          ctx.fill();

          // Reticle over hot spot
          ctx.strokeStyle = "#fde047";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(sX, sY, 14 * zoomLevel, 0, Math.PI * 2);
          ctx.stroke();

          // Thermal measurement tag
          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 9px monospace";
          ctx.fillText(`+${survivor.temp.toFixed(1)}°C`, sX + 18, sY - 6);
          ctx.fillStyle = "#f59e0b";
          ctx.font = "8px monospace";
          ctx.fillText("FLIR HOTSPOT", sX + 18, sY + 6);

        } else if (visionMode === "nvg") {
          // Night vision infrared illuminator bounce
          const nvgRad = ctx.createRadialGradient(sX, sY, 2, sX, sY, 25 * zoomLevel);
          nvgRad.addColorStop(0, "#ffffff");
          nvgRad.addColorStop(0.3, "#34d399");
          nvgRad.addColorStop(1, "rgba(16, 185, 129, 0)");

          ctx.fillStyle = nvgRad;
          ctx.beginPath();
          ctx.arc(sX, sY, 25 * zoomLevel, 0, Math.PI * 2);
          ctx.fill();

        } else {
          // RGB Optical person silhouette marker
          ctx.fillStyle = "#38bdf8";
          ctx.beginPath();
          ctx.arc(sX, sY, 4 * zoomLevel, 0, Math.PI * 2);
          ctx.fill();
        }

        // YOLOv8 Bounding Box with Corner Brackets
        const boxSize = 36 * zoomLevel;
        const half = boxSize / 2;
        const corner = 8;
        const boxColor = visionMode === "thermal" ? "#f59e0b" : visionMode === "nvg" ? "#10b981" : "#00f2fe";

        ctx.strokeStyle = boxColor;
        ctx.lineWidth = 2;

        // Top-left corner
        ctx.beginPath();
        ctx.moveTo(sX - half, sY - half + corner);
        ctx.lineTo(sX - half, sY - half);
        ctx.lineTo(sX - half + corner, sY - half);
        ctx.stroke();

        // Top-right corner
        ctx.beginPath();
        ctx.moveTo(sX + half - corner, sY - half);
        ctx.lineTo(sX + half, sY - half);
        ctx.lineTo(sX + half, sY - half + corner);
        ctx.stroke();

        // Bottom-left corner
        ctx.beginPath();
        ctx.moveTo(sX - half, sY + half - corner);
        ctx.lineTo(sX - half, sY + half);
        ctx.lineTo(sX - half + corner, sY + half);
        ctx.stroke();

        // Bottom-right corner
        ctx.beginPath();
        ctx.moveTo(sX + half - corner, sY + half);
        ctx.lineTo(sX + half, sY + half);
        ctx.lineTo(sX + half, sY + half - corner);
        ctx.stroke();

        // YOLO Tag Banner
        ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
        ctx.fillRect(sX - half, sY - half - 16, 130, 14);
        ctx.fillStyle = boxColor;
        ctx.font = "bold 9px monospace";
        ctx.fillText(`HUMAN // ${(survivor.conf * 100).toFixed(0)}% CONF`, sX - half + 3, sY - half - 5);

        // Required Aid Pill
        ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
        ctx.fillRect(sX - half, sY + half + 4, 130, 14);
        ctx.fillStyle = "#38bdf8";
        ctx.font = "bold 8px monospace";
        ctx.fillText(`REQ: ${survivor.need.slice(0, 17)}`, sX - half + 3, sY + half + 14);
      });

      // --- 3. OBSTACLE COLLISION WARNING (IF ACTIVE) ---
      if (telemetry.obstacleNear) {
        const obsX = centerX + 40;
        const obsY = centerY - 35;
        const pulse = Math.abs(Math.sin(now * 0.008));

        ctx.strokeStyle = `rgba(244, 63, 94, ${0.5 + pulse * 0.5})`;
        ctx.lineWidth = 3;
        ctx.strokeRect(obsX - 35, obsY - 35, 70, 70);

        ctx.fillStyle = "rgba(244, 63, 94, 0.85)";
        ctx.fillRect(obsX - 55, obsY - 50, 110, 14);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 8px monospace";
        ctx.fillText(`⚠️ HAZARD: ${telemetry.obstacleName?.slice(0, 10) || "CRANE"}`, obsX - 52, obsY - 40);

        // Evasion vector line
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "#f43f5e";
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(obsX, obsY);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // --- 4. GIMBAL HUD RETICLE & ARTIFICIAL HORIZON ---
      ctx.save();
      ctx.translate(centerX, centerY);

      // Pitch & Roll Artificial Horizon Line
      ctx.rotate((stateRef.current.roll * Math.PI) / 180);
      const pitchY = stateRef.current.pitch * 2.5;

      ctx.strokeStyle = "rgba(0, 242, 254, 0.4)";
      ctx.lineWidth = 1;

      // Horizon Wings
      ctx.beginPath();
      ctx.moveTo(-50, pitchY);
      ctx.lineTo(-20, pitchY);
      ctx.moveTo(20, pitchY);
      ctx.lineTo(50, pitchY);
      ctx.stroke();

      // Pitch ladder notches
      [-20, -10, 10, 20].forEach((deg) => {
        const y = pitchY + deg * 2;
        ctx.beginPath();
        ctx.moveTo(-12, y);
        ctx.lineTo(12, y);
        ctx.stroke();
      });

      // Center Bore Crosshair
      ctx.rotate(-(stateRef.current.roll * Math.PI) / 180);
      ctx.strokeStyle = visionMode === "thermal" ? "#f59e0b" : "#00f2fe";
      ctx.lineWidth = 1.5;

      // Circular reticle
      ctx.beginPath();
      ctx.arc(0, 0, 24, 0, Math.PI * 2);
      ctx.stroke();

      // Center dot
      ctx.fillStyle = visionMode === "thermal" ? "#fde047" : "#00f2fe";
      ctx.beginPath();
      ctx.arc(0, 0, 2, 0, Math.PI * 2);
      ctx.fill();

      // Hairlines
      ctx.beginPath();
      ctx.moveTo(-34, 0);
      ctx.lineTo(-24, 0);
      ctx.moveTo(24, 0);
      ctx.lineTo(34, 0);
      ctx.moveTo(0, -34);
      ctx.lineTo(0, -24);
      ctx.moveTo(0, 24);
      ctx.lineTo(0, 34);
      ctx.stroke();

      ctx.restore();

      // --- 5. COMPASS AZIMUTH HEADING TAPE (TOP) ---
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.fillRect(width * 0.25, 4, width * 0.5, 18);
      ctx.strokeStyle = "rgba(0, 242, 254, 0.3)";
      ctx.strokeRect(width * 0.25, 4, width * 0.5, 18);

      const heading = Math.round(stateRef.current.heading);
      ctx.font = "bold 9px monospace";
      ctx.fillStyle = "#00f2fe";
      ctx.textAlign = "center";
      ctx.fillText(`▲ ${heading.toString().padStart(3, "0")}° ${getCardinal(heading)} ▲`, width / 2, 17);
      ctx.textAlign = "left";

      // --- 6. FLIR RADIOMETRIC ISOTHERM BAR (RIGHT SIDE) ---
      if (visionMode === "thermal") {
        const barW = 10;
        const barH = height * 0.6;
        const barX = width - 20;
        const barY = height * 0.2;

        const flirGrad = ctx.createLinearGradient(0, barY, 0, barY + barH);
        flirGrad.addColorStop(0, "#ffffff"); // 45°C
        flirGrad.addColorStop(0.2, "#fde047"); // 37°C
        flirGrad.addColorStop(0.4, "#f97316"); // 30°C
        flirGrad.addColorStop(0.65, "#9333ea"); // 22°C
        flirGrad.addColorStop(0.85, "#1e1b4b"); // 15°C
        flirGrad.addColorStop(1, "#030712"); // 10°C

        ctx.fillStyle = flirGrad;
        ctx.fillRect(barX, barY, barW, barH);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
        ctx.strokeRect(barX, barY, barW, barH);

        // Temp scale labels
        ctx.font = "8px monospace";
        ctx.fillStyle = "#ffffff";
        ctx.fillText("45°", barX - 18, barY + 8);
        ctx.fillStyle = "#fde047";
        ctx.fillText("37°", barX - 18, barY + barH * 0.22);
        ctx.fillStyle = "#9333ea";
        ctx.fillText("22°", barX - 18, barY + barH * 0.65);
        ctx.fillStyle = "#60a5fa";
        ctx.fillText("10°", barX - 18, barY + barH);
      }

      ctx.restore();

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      isRunning = false;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [visionMode, zoomLevel, telemetry, detections]);

  // Helper for compass headings
  function getCardinal(deg: number) {
    const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return directions[Math.round(deg / 45) % 8];
  }

  return (
    <div style={{ position: "relative", width: "100%", borderRadius: "6px", overflow: "hidden", background: "#05070d", border: "1px solid rgba(255, 255, 255, 0.1)" }}>
      {/* Top Stream Status & In-Feed Control Toolbar */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "6px 10px",
        background: "rgba(10, 15, 29, 0.9)",
        borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        fontSize: "11px",
        fontFamily: "var(--font-mono)"
      }}>
        {/* Left: Mode Selection Tabs */}
        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          <button
            onClick={() => handleModeChange("optical")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              background: visionMode === "optical" ? "rgba(0, 242, 254, 0.2)" : "rgba(255, 255, 255, 0.05)",
              color: visionMode === "optical" ? "var(--cyan-bright)" : "#94a3b8",
              border: `1px solid ${visionMode === "optical" ? "var(--cyan-bright)" : "transparent"}`,
              borderRadius: "4px",
              padding: "3px 7px",
              cursor: "pointer",
              fontSize: "10px",
              fontWeight: 600
            }}
          >
            <Eye size={12} /> 4K OPTICAL
          </button>

          <button
            onClick={() => handleModeChange("thermal")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              background: visionMode === "thermal" ? "rgba(245, 158, 11, 0.25)" : "rgba(255, 255, 255, 0.05)",
              color: visionMode === "thermal" ? "#f59e0b" : "#94a3b8",
              border: `1px solid ${visionMode === "thermal" ? "#f59e0b" : "transparent"}`,
              borderRadius: "4px",
              padding: "3px 7px",
              cursor: "pointer",
              fontSize: "10px",
              fontWeight: 600
            }}
          >
            <Flame size={12} /> FLIR THERMAL
          </button>

          <button
            onClick={() => handleModeChange("nvg")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "4px",
              background: visionMode === "nvg" ? "rgba(16, 185, 129, 0.25)" : "rgba(255, 255, 255, 0.05)",
              color: visionMode === "nvg" ? "#10b981" : "#94a3b8",
              border: `1px solid ${visionMode === "nvg" ? "#10b981" : "transparent"}`,
              borderRadius: "4px",
              padding: "3px 7px",
              cursor: "pointer",
              fontSize: "10px",
              fontWeight: 600
            }}
          >
            <Zap size={12} /> NVG
          </button>
        </div>

        {/* Right: Zoom & Recon Snapshot */}
        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
          {/* Zoom Buttons */}
          {([1, 2, 4] as const).map((z) => (
            <button
              key={z}
              onClick={() => setZoomLevel(z)}
              style={{
                background: zoomLevel === z ? "rgba(255, 255, 255, 0.2)" : "rgba(255, 255, 255, 0.05)",
                color: zoomLevel === z ? "#fff" : "#94a3b8",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: "3px",
                padding: "2px 5px",
                cursor: "pointer",
                fontSize: "9px"
              }}
            >
              {z}X
            </button>
          ))}

          {/* Recon Snapshot Button */}
          <button
            onClick={triggerSnapshot}
            title="Capture Aerial Recon Frame"
            style={{
              background: "rgba(0, 242, 254, 0.1)",
              border: "1px solid rgba(0, 242, 254, 0.3)",
              color: "var(--cyan-bright)",
              borderRadius: "3px",
              padding: "2px 6px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "3px",
              fontSize: "9px"
            }}
          >
            <Camera size={11} /> SNAP
          </button>
        </div>
      </div>

      {/* Main Video Viewport Canvas with HUD */}
      <div style={{ position: "relative", width: "100%", aspectRatio: "16/9", overflow: "hidden", background: "#000" }}>
        <canvas
          ref={canvasRef}
          width={640}
          height={360}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            objectFit: "cover"
          }}
        />

        {/* Flash overlay for snapshot */}
        {snapshotFlash && (
          <div style={{
            position: "absolute",
            inset: 0,
            background: "#ffffff",
            opacity: 0.8,
            pointerEvents: "none",
            transition: "opacity 0.2s ease-out"
          }} />
        )}

        {/* Live HUD Telemetry Overlay (Top-Left) */}
        <div style={{
          position: "absolute",
          top: "8px",
          left: "10px",
          pointerEvents: "none",
          fontSize: "10px",
          fontFamily: "var(--font-mono)",
          color: visionMode === "thermal" ? "#fde047" : "var(--cyan-bright)",
          textShadow: "0 1px 3px rgba(0, 0, 0, 0.9)",
          lineHeight: 1.4
        }}>
          <div>SENSOR: {visionMode === "thermal" ? "FLIR BOSON LWIR" : visionMode === "nvg" ? "GEN-3 NVG GAAS" : "SONY 4K EXMOR"}</div>
          <div style={{ opacity: 0.85 }}>ZOOM: {zoomLevel}.0X // FPS: {fps} // RES: 1080p</div>
        </div>

        {/* Live HUD Telemetry Overlay (Top-Right) */}
        <div style={{
          position: "absolute",
          top: "8px",
          right: "10px",
          pointerEvents: "none",
          display: "flex",
          alignItems: "center",
          gap: "5px",
          fontSize: "10px",
          fontFamily: "var(--font-mono)",
          color: "#10b981",
          textShadow: "0 1px 3px rgba(0, 0, 0, 0.9)"
        }}>
          <span style={{
            display: "inline-block",
            width: "7px",
            height: "7px",
            borderRadius: "50%",
            background: "#ef4444",
            boxShadow: "0 0 8px #ef4444",
            animation: "pulse 1.5s infinite"
          }} />
          <span>REC ● LIVE</span>
        </div>

        {/* Bottom Avionics Overlay */}
        <div style={{
          position: "absolute",
          bottom: "6px",
          left: "10px",
          pointerEvents: "none",
          fontSize: "9px",
          fontFamily: "var(--font-mono)",
          color: "#94a3b8",
          textShadow: "0 1px 3px rgba(0, 0, 0, 0.9)"
        }}>
          LAT: {telemetry.lat.toFixed(5)}°N // LNG: {telemetry.lng.toFixed(5)}°E // ALT: {telemetry.altitude.toFixed(0)}m AGL
        </div>

        {/* Model & AI Status (Bottom-Right) */}
        <div style={{
          position: "absolute",
          bottom: "6px",
          right: "10px",
          pointerEvents: "none",
          fontSize: "9px",
          fontFamily: "var(--font-mono)",
          color: visionMode === "thermal" ? "#f59e0b" : "#38bdf8",
          textShadow: "0 1px 3px rgba(0, 0, 0, 0.9)"
        }}>
          YOLOv8-SAR // CONF: 98.4%
        </div>
      </div>
    </div>
  );
}
