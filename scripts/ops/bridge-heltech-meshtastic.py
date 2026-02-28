#!/usr/bin/env python3
import argparse
import json
import signal
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict, Optional, Tuple


def now_ms() -> int:
    return int(time.time() * 1000)


def as_dict(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if value is None:
        return {}
    if hasattr(value, "__dict__"):
        return {k: v for k, v in vars(value).items() if not k.startswith("_")}
    return {}


def get_any(container: Any, *keys: str) -> Any:
    if container is None:
        return None
    if isinstance(container, dict):
        for key in keys:
            if key in container:
                return container[key]
        return None
    for key in keys:
        if hasattr(container, key):
            return getattr(container, key)
    return None


def to_float(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        if value != value:
            return None
        return float(value)
    if isinstance(value, str):
        try:
            parsed = float(value.strip())
            if parsed != parsed:
                return None
            return parsed
        except ValueError:
            return None
    return None


def to_bool(value: Any) -> Optional[bool]:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "on"}:
            return True
        if lowered in {"false", "0", "no", "off"}:
            return False
    return None


def choose_local_node(nodes: Dict[Any, Any], my_node_num: Any) -> Optional[Dict[str, Any]]:
    if not nodes:
        return None

    if my_node_num is not None:
        for key, node in nodes.items():
            if str(key) == str(my_node_num):
                return as_dict(node)
            node_num = get_any(node, "num", "nodeNum", "node_num")
            if node_num is not None and str(node_num) == str(my_node_num):
                return as_dict(node)

    for node in nodes.values():
        node_dict = as_dict(node)
        if bool(get_any(node_dict, "isLocal", "is_local")):
            return node_dict

    def heard_ts(node_obj: Any) -> float:
        node_dict = as_dict(node_obj)
        value = to_float(get_any(node_dict, "lastHeard", "last_heard", "lastSeen", "last_seen"))
        return value if value is not None else -1.0

    return as_dict(max(nodes.values(), key=heard_ts))


def normalize_position(position: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    lat = to_float(get_any(position, "latitude", "lat"))
    lon = to_float(get_any(position, "longitude", "lon"))

    if lat is None or lon is None:
        lat_i = to_float(get_any(position, "latitudeI", "latitude_i"))
        lon_i = to_float(get_any(position, "longitudeI", "longitude_i"))
        if lat_i is not None and lon_i is not None:
            lat = lat_i / 1e7
            lon = lon_i / 1e7

    if lat is None or lon is None:
        return None
    if not (-90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        return None

    telemetry_gps: Dict[str, Any] = {"lat": lat, "lon": lon}
    alt = to_float(get_any(position, "altitude", "altitudeM", "altitude_m", "alt"))
    if alt is not None:
        telemetry_gps["alt_m"] = alt

    sats = to_float(get_any(position, "satsInView", "sats", "numSats", "satellites"))
    if sats is not None and sats >= 0:
        telemetry_gps["sats"] = int(sats)

    hdop = to_float(get_any(position, "hdop", "HDOP"))
    if hdop is not None and hdop >= 0:
        telemetry_gps["hdop"] = hdop

    speed = to_float(get_any(position, "speed", "speedMps", "speed_mps"))
    if speed is not None and speed >= 0:
        telemetry_gps["speed_mps"] = speed

    course = to_float(get_any(position, "heading", "course", "course_deg"))
    if course is not None:
        telemetry_gps["course_deg"] = max(0.0, min(360.0, course))

    pos_ts = to_float(get_any(position, "time", "timestamp"))
    if pos_ts is not None and pos_ts > 0:
        if pos_ts < 10_000_000_000:
            telemetry_gps["timestamp"] = int(pos_ts * 1000)
        else:
            telemetry_gps["timestamp"] = int(pos_ts)

    fix = to_bool(get_any(position, "gpsFix", "fix", "hasFix", "has_fix"))
    if fix is not None:
        telemetry_gps["fix"] = fix

    telemetry_gps["source"] = "meshtastic"
    return telemetry_gps


def build_telemetry(node: Dict[str, Any]) -> Dict[str, Any]:
    telemetry: Dict[str, Any] = {}
    position = as_dict(get_any(node, "position"))
    if position:
        gps = normalize_position(position)
        if gps:
            telemetry["gps"] = gps

    metrics = as_dict(get_any(node, "deviceMetrics", "device_metrics", "metrics"))
    if metrics:
        power: Dict[str, Any] = {}
        battery = to_float(get_any(metrics, "batteryLevel", "batteryPct", "battery_percent"))
        if battery is not None:
            power["battery_pct"] = max(0.0, min(100.0, battery))
        voltage = to_float(get_any(metrics, "voltage", "batteryVoltage", "voltage_v"))
        if voltage is not None and voltage > 0:
            power["voltage_v"] = voltage
        if power:
            telemetry["power"] = power

    radio: Dict[str, Any] = {}
    snr = to_float(get_any(node, "snr", "lastSnr", "rxSnr", "loraSnr"))
    if snr is not None:
        radio["snr_db"] = snr
    rssi = to_float(get_any(node, "rssi", "lastRssi", "rxRssi", "loraRssi"))
    if rssi is not None:
        radio["rssi_dbm"] = rssi
    if radio:
        telemetry["radio"] = radio

    user = as_dict(get_any(node, "user"))
    device: Dict[str, Any] = {"transport": "meshtastic-serial"}
    model = get_any(user, "hwModel", "model")
    if model is not None:
        device["model"] = str(model)
    firmware = get_any(user, "firmwareVersion", "firmware", "version")
    if firmware is not None:
        device["firmware"] = str(firmware)
    role = get_any(user, "role")
    if role is not None:
        device["role"] = str(role)
    if device:
        telemetry["device"] = device

    return telemetry


def post_presence(url: str, payload: Dict[str, Any], timeout_sec: float) -> Tuple[int, str]:
    data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(
        f"{url.rstrip('/')}/ralphie/presence",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
        body = resp.read().decode("utf-8", errors="replace")
        return int(resp.getcode()), body


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Bridge Meshtastic USB telemetry into AetherCore RALPHIE_PRESENCE."
    )
    connect = parser.add_mutually_exclusive_group(required=True)
    connect.add_argument("--port", help="Meshtastic serial port (e.g. /dev/cu.usbmodem...)")
    connect.add_argument("--host", help="Meshtastic TCP host/IP (Wi-Fi mode)")
    parser.add_argument("--tcp-port", type=int, default=4403, help="Meshtastic TCP port in Wi-Fi mode (default: 4403)")
    parser.add_argument("--device-id", required=True, help="AetherCore node id")
    parser.add_argument("--hardware-serial", default=None, help="Hardware serial (default: derived from device id)")
    parser.add_argument("--certificate-serial", default=None, help="Certificate serial (default: heltech-<device-id>)")
    parser.add_argument("--mesh-endpoint", default="ws://localhost:3000", help="Mesh endpoint metadata")
    parser.add_argument("--gateway-http", default="http://127.0.0.1:3000", help="Gateway HTTP base URL")
    parser.add_argument("--trust-score", type=float, default=0.35, help="Trust score [0..1]")
    parser.add_argument("--tpm-backed", action="store_true", help="Set tpm_backed=true (default false)")
    parser.add_argument("--enrolled-at-ms", type=int, default=now_ms(), help="Enrollment epoch ms")
    parser.add_argument("--interval-sec", type=int, default=30, help="Heartbeat interval in seconds")
    parser.add_argument("--warmup-sec", type=float, default=2.0, help="Initial node cache warmup delay")
    parser.add_argument("--http-timeout-sec", type=float, default=5.0, help="HTTP timeout for gateway POST")
    parser.add_argument("--oneshot", action="store_true", help="Send startup frame once and exit")
    parser.add_argument("--verbose", action="store_true", help="Verbose logging")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if not (0.0 <= args.trust_score <= 1.0):
        print("ERROR: --trust-score must be between 0 and 1", file=sys.stderr)
        return 2
    if args.interval_sec < 5:
        print("ERROR: --interval-sec must be >= 5", file=sys.stderr)
        return 2
    if args.enrolled_at_ms <= 0:
        print("ERROR: --enrolled-at-ms must be positive", file=sys.stderr)
        return 2
    if args.host and (args.tcp_port < 1 or args.tcp_port > 65535):
        print("ERROR: --tcp-port must be between 1 and 65535", file=sys.stderr)
        return 2

    hardware_serial = args.hardware_serial or args.device_id
    certificate_serial = args.certificate_serial or f"heltech-{args.device_id}"

    try:
        if args.host:
            from meshtastic.tcp_interface import TCPInterface  # type: ignore
        else:
            from meshtastic.serial_interface import SerialInterface  # type: ignore
    except Exception as exc:
        print(
            "ERROR: meshtastic Python library is not installed. "
            "Install with: python3 -m pip install --user meshtastic",
            file=sys.stderr,
        )
        print(f"Import detail: {exc}", file=sys.stderr)
        return 3

    stop = {"flag": False}

    def _handle_signal(signum: int, _frame: Any) -> None:
        stop["flag"] = True
        print(f"signal={signum} stopping")

    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    try:
        if args.host:
            iface = TCPInterface(hostname=args.host, portNumber=args.tcp_port)
            transport_desc = f"tcp://{args.host}:{args.tcp_port}"
        else:
            iface = SerialInterface(devPath=args.port)
            transport_desc = args.port
    except Exception as exc:
        if args.host:
            print(
                f"ERROR: failed to connect to Meshtastic host {args.host}:{args.tcp_port}: {exc}",
                file=sys.stderr,
            )
        else:
            print(f"ERROR: failed to connect to Meshtastic port {args.port}: {exc}", file=sys.stderr)
        return 4

    print("Meshtastic bridge config:")
    print(f"  transport={transport_desc}")
    print(f"  device_id={args.device_id}")
    print(f"  mesh_endpoint={args.mesh_endpoint}")
    print(f"  gateway_http={args.gateway_http}")
    print(f"  interval_sec={args.interval_sec}")
    print(f"  trust_score={args.trust_score}")
    print(f"  tpm_backed={args.tpm_backed}")

    time.sleep(max(0.0, args.warmup_sec))

    last_disconnect_reason = "unknown"
    sent_count = 0

    try:
        while not stop["flag"]:
            reason = "startup" if sent_count == 0 else "heartbeat"
            telemetry: Dict[str, Any] = {}
            try:
                nodes = as_dict(getattr(iface, "nodes", {}))
                my_info = get_any(iface, "myInfo", "my_info")
                my_node_num = get_any(my_info, "my_node_num", "myNodeNum")
                local_node = choose_local_node(nodes, my_node_num)
                if local_node:
                    telemetry = build_telemetry(local_node)
                    last_disconnect_reason = "unknown"
                else:
                    last_disconnect_reason = "no_local_node_in_cache"
            except Exception as exc:
                last_disconnect_reason = f"meshtastic_poll_failed:{str(exc)[:120]}"

            payload: Dict[str, Any] = {
                "type": "RALPHIE_PRESENCE",
                "reason": reason,
                "timestamp": now_ms(),
                "endpoint": args.mesh_endpoint,
                "last_disconnect_reason": last_disconnect_reason,
                "identity": {
                    "device_id": args.device_id,
                    "hardware_serial": hardware_serial,
                    "certificate_serial": certificate_serial,
                    "trust_score": args.trust_score,
                    "enrolled_at": args.enrolled_at_ms,
                    "tpm_backed": bool(args.tpm_backed),
                },
            }
            if telemetry:
                payload["telemetry"] = telemetry

            try:
                status_code, body = post_presence(args.gateway_http, payload, args.http_timeout_sec)
                print(f"publish reason={reason} status={status_code} body={body}")
                if status_code != 202:
                    last_disconnect_reason = f"gateway_http_{status_code}"
                else:
                    sent_count += 1
            except urllib.error.HTTPError as exc:
                details = exc.read().decode("utf-8", errors="replace")
                last_disconnect_reason = f"gateway_http_{exc.code}"
                print(f"ERROR: publish failed status={exc.code} body={details}", file=sys.stderr)
            except Exception as exc:
                last_disconnect_reason = f"gateway_post_failed:{str(exc)[:120]}"
                print(f"ERROR: publish exception: {exc}", file=sys.stderr)

            if args.oneshot:
                break
            for _ in range(args.interval_sec):
                if stop["flag"]:
                    break
                time.sleep(1)
    finally:
        try:
            iface.close()
        except Exception:
            pass

    print("DONE: meshtastic bridge stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
