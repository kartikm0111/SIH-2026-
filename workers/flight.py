import argparse
import math
import time

import requests

from common import get, post


def distance_meters(lat1, lng1, lat2, lng2):
    mean_lat = math.radians((lat1 + lat2) / 2)
    north = (lat2 - lat1) * 111_320
    east = (lng2 - lng1) * 111_320 * math.cos(mean_lat)
    return math.hypot(north, east)


class MockDrone:
    def __init__(self, initial):
        self.lat = initial["lat"]
        self.lng = initial["lng"]
        self.altitude = 0.0
        self.battery = 100.0
        self.mode = "IDLE"
        self.target = None

    def start_mission(self, mission):
        self.target = mission
        self.mode = "TAKING_OFF"

    def tick(self, dt):
        if not self.target:
            return

        target_altitude = self.target["altitude"]

        # Climb at 5 m/s before horizontal travel.
        if self.altitude < target_altitude:
            self.altitude = min(
                target_altitude,
                self.altitude + 5 * dt,
            )
            self.mode = "TAKING_OFF"
        else:
            distance = distance_meters(
                self.lat,
                self.lng,
                self.target["lat"],
                self.target["lng"],
            )

            if distance <= 2:
                self.lat = self.target["lat"]
                self.lng = self.target["lng"]
                self.mode = "ARRIVED"
            else:
                # Kinematic simulation, not flight dynamics.
                fraction = min(1.0, 18 * dt / distance)
                self.lat += (self.target["lat"] - self.lat) * fraction
                self.lng += (self.target["lng"] - self.lng) * fraction
                self.mode = "EN_ROUTE"

        self.battery = max(0, self.battery - 0.015 * dt)

    def telemetry(self):
        return {
            "lat": self.lat,
            "lng": self.lng,
            "altitude": self.altitude,
            "battery": self.battery,
            "mode": self.mode,
            "source": "mock",
        }

    def close(self):
        pass


class SitlDrone:
    """Optional adapter. Use ONLY with a local simulated vehicle."""

    def __init__(self):
        from dronekit import connect, LocationGlobalRelative, VehicleMode

        self.LocationGlobalRelative = LocationGlobalRelative
        self.VehicleMode = VehicleMode

        self.vehicle = connect(
            "tcp:127.0.0.1:5760",
            wait_ready=True,
            heartbeat_timeout=30,
        )
        self.target = None
        self.goto_sent = False

    def wait_until(self, predicate, timeout, description):
        deadline = time.monotonic() + timeout

        while not predicate():
            if time.monotonic() > deadline:
                raise TimeoutError(description)
            time.sleep(0.5)

    def start_mission(self, mission):
        self.target = mission
        self.goto_sent = False

        if not self.vehicle.armed:
            self.wait_until(
                lambda: self.vehicle.is_armable,
                60,
                "SITL did not become armable",
            )

        self.vehicle.mode = self.VehicleMode("GUIDED")
        self.wait_until(
            lambda: self.vehicle.mode.name == "GUIDED",
            15,
            "SITL did not enter GUIDED mode",
        )

        if not self.vehicle.armed:
            self.vehicle.armed = True
            self.wait_until(
                lambda: self.vehicle.armed,
                20,
                "SITL did not arm",
            )

        altitude = self.vehicle.location.global_relative_frame.alt or 0

        if altitude < mission["altitude"] * 0.9:
            self.vehicle.simple_takeoff(mission["altitude"])

    def tick(self, dt):
        if not self.target or self.goto_sent:
            return

        altitude = self.vehicle.location.global_relative_frame.alt or 0

        if altitude >= self.target["altitude"] * 0.9:
            destination = self.LocationGlobalRelative(
                self.target["lat"],
                self.target["lng"],
                self.target["altitude"],
            )
            self.vehicle.simple_goto(destination, groundspeed=12)
            self.goto_sent = True

    def telemetry(self):
        location = self.vehicle.location.global_relative_frame
        battery = self.vehicle.battery.level

        if battery is None or not 0 <= battery <= 100:
            battery = None

        return {
            "lat": location.lat,
            "lng": location.lon,
            "altitude": location.alt or 0,
            "battery": battery,
            "mode": self.vehicle.mode.name,
            "source": "sitl",
        }

    def close(self):
        self.vehicle.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sitl", action="store_true")
    args = parser.parse_args()

    initial = get("/api/state")["telemetry"]
    drone = SitlDrone() if args.sitl else MockDrone(initial)

    mission_id = None
    previous_tick = time.monotonic()

    print("Flight worker:", "DroneKit SITL" if args.sitl else "mock simulation")

    try:
        while True:
            started = time.monotonic()
            dt = min(started - previous_tick, 1.0)
            previous_tick = started

            try:
                mission = get("/api/mission")["mission"]

                if mission and mission["id"] != mission_id:
                    drone.start_mission(mission)
                    mission_id = mission["id"]
                    print("Mission accepted:", mission_id)

                drone.tick(dt)
                post("/api/telemetry", drone.telemetry())

            except requests.RequestException as exc:
                print("API connection error:", exc)
                time.sleep(1)

            time.sleep(max(0, 0.2 - (time.monotonic() - started)))

    except KeyboardInterrupt:
        print("Flight worker stopped")
    finally:
        drone.close()


if __name__ == "__main__":
    main()
