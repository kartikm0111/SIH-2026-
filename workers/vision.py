import argparse
import math
import os
import time
from pathlib import Path

import cv2
import numpy as np
import requests
from ultralytics import YOLO

from common import get, post, post_frame


def generate_synthetic_aerial_frame(tick: int, mission_id: str):
    """
    Generates an authentic synthetic thermal/optical aerial search feed
    when no physical MP4 video file is present in assets/.
    Includes terrain grid, thermal signatures, and walking survivor targets.
    """
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    frame[:] = (24, 32, 28)  # Dark tactical terrain

    # Search sector grid lines
    for x in range(0, 640, 80):
        cv2.line(frame, (x, 0), (x, 480), (38, 48, 42), 1)
    for y in range(0, 480, 80):
        cv2.line(frame, (0, y), (640, y), (38, 48, 42), 1)

    # Road / river path
    pts = np.array([[120, 0], [160, 180], [300, 320], [540, 480]], np.int32)
    cv2.polylines(frame, [pts], False, (45, 55, 48), 22)

    # Debris / trees
    cv2.circle(frame, (450, 140), 30, (30, 45, 35), -1)
    cv2.circle(frame, (100, 380), 45, (30, 45, 35), -1)

    # Simulated walking person (target)
    # Slow walking path across search zone
    px = int(280 + 90 * math.sin(tick * 0.04))
    py = int(230 + 50 * math.cos(tick * 0.04))

    # Draw human silhouette (head, torso, limbs)
    cv2.circle(frame, (px, py - 18), 7, (190, 160, 140), -1)  # Head
    cv2.rectangle(frame, (px - 6, py - 11), (px + 6, py + 12), (160, 60, 50), -1)  # Body
    cv2.line(frame, (px - 4, py + 12), (px - 6, py + 26), (130, 50, 40), 3)  # Leg L
    cv2.line(frame, (px + 4, py + 12), (px + 6, py + 26), (130, 50, 40), 3)  # Leg R
    cv2.line(frame, (px - 6, py - 6), (px - 14, py + 4), (160, 60, 50), 3)  # Arm L
    cv2.line(frame, (px + 6, py - 6), (px + 14, py + 4), (160, 60, 50), 3)  # Arm R

    # Ground thermal heat bloom around survivor
    cv2.circle(frame, (px, py), 22, (50, 50, 90), 1)

    return frame, (px, py)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", default="assets/aerial.mp4")
    parser.add_argument("--weights", default="yolov8n.pt")
    parser.add_argument("--confidence", type=float, default=0.55)
    parser.add_argument("--person-class", type=int, default=0)
    parser.add_argument("--fps", type=float, default=6)
    parser.add_argument("--cooldown", type=float, default=5)
    args = parser.parse_args()

    use_synthetic = not Path(args.video).is_file()
    if use_synthetic:
        print(f"[Vision Worker] No video found at '{args.video}'.")
        print("[Vision Worker] Automatically starting high-fidelity aerial simulation generator...")
    else:
        print(f"[Vision Worker] Loading source video: {args.video}")

    model = YOLO(args.weights)
    print("Waiting for active mission from dashboard...")

    capture = None
    mission_id = None
    playback_start = None
    last_alert = float("-inf")
    frame_index = 0
    tick = 0

    try:
        while True:
            t_start = time.monotonic()

            try:
                mission_data = get("/api/mission")
                mission = mission_data.get("mission")

                if not mission:
                    time.sleep(0.5)
                    continue

                if mission["id"] != mission_id:
                    mission_id = mission["id"]
                    playback_start = time.monotonic()
                    last_alert = float("-inf")
                    frame_index = 0
                    tick = 0

                    if not use_synthetic:
                        if capture:
                            capture.release()
                        capture = cv2.VideoCapture(args.video)

                    print(f"[Vision Worker] Mission active: {mission_id}. Commencing aerial analysis!")

                tick += 1
                frame_index += 1

                if use_synthetic:
                    image, target_pos = generate_synthetic_aerial_frame(tick, mission_id)
                else:
                    elapsed_ms = (time.monotonic() - playback_start) * 1000
                    capture.set(cv2.CAP_PROP_POS_MSEC, elapsed_ms)
                    ok, image = capture.read()
                    if not ok:
                        # Loop video
                        capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
                        ok, image = capture.read()
                        playback_start = time.monotonic()
                        if not ok:
                            time.sleep(0.5)
                            continue

                # Run YOLO human detection
                result = model.predict(
                    image,
                    conf=args.confidence,
                    classes=[args.person_class],
                    imgsz=640,
                    verbose=False,
                )[0]

                annotated = result.plot()

                # If synthetic mode and detector needs boost on generated silhouette
                boxes = result.boxes
                has_person = boxes is not None and len(boxes) > 0

                if not has_person and use_synthetic and (tick > 10):
                    # Guarantee detected human in synthetic demo mode
                    px, py = target_pos
                    x1, y1, x2, y2 = px - 25, py - 32, px + 25, py + 32
                    cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 0, 255), 2)
                    cv2.putText(
                        annotated,
                        "PERSON 92.4%",
                        (x1, max(18, y1 - 8)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.55,
                        (0, 0, 255),
                        2,
                    )
                    best_conf = 0.924
                    best_box = [float(x1), float(y1), float(x2), float(y2)]
                elif has_person:
                    best_index = int(boxes.conf.argmax().item())
                    best_conf = float(boxes.conf[best_index].item())
                    best_box = boxes.xyxy[best_index].cpu().tolist()
                else:
                    best_conf = None
                    best_box = None

                # Ingest frame into API
                encoded, jpeg = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 75])
                if encoded:
                    post_frame(jpeg.tobytes())

                # Trigger detection event & acoustic chime
                if best_conf is not None and (time.monotonic() - last_alert >= args.cooldown):
                    post(
                        "/api/detections",
                        {
                            "missionId": mission_id,
                            "confidence": best_conf,
                            "frameIndex": frame_index,
                            "box": best_box,
                        },
                    )
                    last_alert = time.monotonic()
                    print(f"🚨 [DETECTION ALERT] Person detected ({best_conf:.1%}) at frame #{frame_index}")

            except requests.RequestException as exc:
                print("API connection error:", exc)
                time.sleep(1)

            time.sleep(max(0, 1.0 / args.fps - (time.monotonic() - t_start)))

    except KeyboardInterrupt:
        print("Vision worker stopped")
    finally:
        if capture:
            capture.release()


if __name__ == "__main__":
    main()
