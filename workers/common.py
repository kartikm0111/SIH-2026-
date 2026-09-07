import os
from pathlib import Path

import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

API_URL = os.getenv("API_URL", "http://127.0.0.1:4000").rstrip("/")
TOKEN = os.environ["WORKER_TOKEN"]

session = requests.Session()
session.headers.update({"x-worker-token": TOKEN})


def get(path):
    response = session.get(f"{API_URL}{path}", timeout=5)
    response.raise_for_status()
    return response.json()


def post(path, payload):
    response = session.post(
        f"{API_URL}{path}",
        json=payload,
        timeout=5,
    )
    response.raise_for_status()
    return response


def post_frame(jpeg_bytes):
    response = session.post(
        f"{API_URL}/api/frame",
        data=jpeg_bytes,
        headers={"Content-Type": "image/jpeg"},
        timeout=5,
    )
    response.raise_for_status()
