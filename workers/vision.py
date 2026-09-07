import argparse
import time
from pathlib import Path

import cv2
import requests
from ultralytics import YOLO

from common import get, post, post_frame


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--weights", default="yolov8n.pt")
    parser.add_argument("--confidence", type=float, default=0.80)
    parser.add_argument("--person-class", type=int, default=0)
    parser.add_argument("--fps", type=float, default=5)
    parser.add_argument("--cooldown", type=float, default=10)
    args = parser.parse_args()

    if not Path(args.video).is_file():
        raise FileNotFoundError(args.video)

    if args.fps <= 0 or not 0 <= args.confidence <= 1:
        raise ValueError("FPS must be positive; confidence must be 0–1")

    model = YOLO(args.weights)

    print("Model classes:", model.names)
    print("Waiting for a mission...")

    capture = None
    mission_id = None
    playback_start = None
    last_alert = float("-inf")
    finished = False

    try:
        while True:
            tick = time.monotonic()

            try:
                mission = get("/api/mission")["mission"]

                if not mission:
                    time.sleep(0.5)
                    continue

                if mission["id"] != mission_id:
                    if capture:
                        capture.release()

                    capture = cv2.VideoCapture(args.video)

                    if not capture.isOpened():
                        raise RuntimeError("Unable to open video")

                    mission_id = mission["id"]
                    playback_start = time.monotonic()
                    last_alert = float("-inf")
                    finished = False

                    print("Analyzing video for mission:", mission_id)

                if finished:
                    time.sleep(0.5)
                    continue

                elapsed_ms = (
                    time.monotonic() - playback_start
                ) * 1000

                capture.set(cv2.CAP_PROP_POS_MSEC, elapsed_ms)
                ok, image = capture.read()

                if not ok:
                    finished = True
                    print("Video finished. Click a new target to replay.")
                    continue

                frame_index = max(
                    0,
                    int(capture.get(cv2.CAP_PROP_POS_FRAMES)) - 1,
                )

                result = model.predict(
                    image,
                    conf=args.confidence,
                    classes=[args.person_class],
                    imgsz=640,
                    verbose=False,
                )[0]

                annotated = result.plot()

                height, width = annotated.shape[:2]
                if width > 960:
                    annotated = cv2.resize(
                        annotated,
                        (960, int(height * 960 / width)),
                    )

                encoded, jpeg = cv2.imencode(
                    ".jpg",
                    annotated,
                    [cv2.IMWRITE_JPEG_QUALITY, 75],
                )

                if encoded:
                    post_frame(jpeg.tobytes())

                boxes = result.boxes

                if (
                    boxes is not None
                    and len(boxes) > 0
                    and time.monotonic() - last_alert >= args.cooldown
                ):
                    best_index = int(boxes.conf.argmax().item())
                    confidence = float(boxes.conf[best_index].item())
                    box = boxes.xyxy[best_index].cpu().tolist()

                    post(
                        "/api/detections",
                        {
                            "missionId": mission_id,
                            "confidence": confidence,
                            "frameIndex": frame_index,
                            "box": box,
                        },
                    )

                    last_alert = time.monotonic()

                    print(
                        f"Person detected: {confidence:.1%}, "
                        f"frame {frame_index}"
                    )

            except requests.RequestException as exc:
                print("API connection error:", exc)
                time.sleep(1)

            time.sleep(
                max(0, 1 / args.fps - (time.monotonic() - tick))
            )

    except KeyboardInterrupt:
        print("Vision worker stopped")
    finally:
        if capture:
            capture.release()


if __name__ == "__main__":
    main()
