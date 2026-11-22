"""Operations CLI:  python -m app.cli <command>"""

import argparse
import getpass
from datetime import timedelta

from sqlalchemy import select

from .db import SessionLocal, utcnow
from .models import Device, Facility, Protocol, Sensor, Station, User
from .security import hash_device_key, hash_password, new_device_key


def seed_demo(a):
    from .simulation.seed import seed_demo as run

    with SessionLocal() as db:
        print("Demonstration data created." if run(db, a.days) else "Stations already exist; nothing seeded.")


def create_user(a):
    password = getpass.getpass("Password (12 characters or more): ")
    if len(password) < 12:
        raise SystemExit("Password is too short.")
    with SessionLocal() as db:
        db.add(User(email=a.email.lower(), name=a.name, role=a.role, password_hash=hash_password(password)))
        db.commit()
    print(f"Created {a.role} {a.email}")


def create_station(a):
    from .analysis.protocol import DEFAULT_CONFIG

    with SessionLocal() as db:
        facility = db.scalar(select(Facility).where(Facility.name == a.facility)) or Facility(name=a.facility, timezone=a.timezone)
        protocol = Protocol(name=f"{a.name} protocol", validation_status="unvalidated", config=DEFAULT_CONFIG)
        db.add(Station(code=a.code, name=a.name, origin="live", facility=facility, protocol=protocol, expected_interval_seconds=a.interval))
        db.commit()
    print(f"Created live station {a.code}. Add sensors with add-sensor, then provision a device.")


def add_sensor(a):
    with SessionLocal() as db:
        st = db.scalar(select(Station).where(Station.code == a.station))
        if not st:
            raise SystemExit("Station not found.")
        db.add(Sensor(station_id=st.id, code=a.code, name=a.name, location=a.location, quantity=a.quantity, unit=a.unit, valid_min=a.min, valid_max=a.max, max_step=a.max_step))
        db.commit()
    print(f"Registered {a.code} at {a.station}")


def provision_device(a):
    with SessionLocal() as db:
        st = db.scalar(select(Station).where(Station.code == a.station))
        if not st:
            raise SystemExit("Station not found.")
        key = new_device_key()
        device = db.scalar(select(Device).where(Device.code == a.device))
        if device:
            if not a.rotate:
                raise SystemExit("Device exists. Use --rotate to replace its key.")
            device.key_hash = hash_device_key(key)
        else:
            db.add(Device(code=a.device, station_id=st.id, key_hash=hash_device_key(key)))
        db.commit()
    print(f"X-Device-Id:  {a.device}\nX-Device-Key: {key}\n\nThe key is not stored and cannot be shown again.")


def archive(a):
    from .worker import archive_day

    with SessionLocal() as db:
        for st in db.scalars(select(Station)).all():
            for d in range(1, a.days + 1):
                obj = archive_day(db, st, utcnow() - timedelta(days=d))
                if obj:
                    print(f"{obj.object_key}  {obj.rows} rows")


def upload_dataset(a):
    from pathlib import Path

    from .cloud.registry import get_objects

    key = f"datasets/{Path(a.path).name}"
    get_objects().put(key, Path(a.path).read_bytes(), "text/csv")
    print(f"Stored {key} in {get_objects().provider}")


def check_services(_):
    from .cloud.registry import cloud_status

    status = cloud_status(0)
    print(status["label"])
    for s in status["services"]:
        print(f"  {s['name']:<12} {s['provider']:<12} {s['state']:<10} {s['detail']}")


def main():
    ap = argparse.ArgumentParser(prog="app.cli")
    sub = ap.add_subparsers(required=True)

    def cmd(name, fn, *args):
        p = sub.add_parser(name)
        p.set_defaults(fn=fn)
        for flags, kw in args:
            p.add_argument(*flags, **kw)

    cmd("seed-demo", seed_demo, (["--days"], {"type": int}))
    cmd("create-user", create_user, (["email"], {}), (["name"], {}), (["--role"], {"choices": ("operator", "admin"), "default": "operator"}))
    cmd("create-station", create_station, (["code"], {}), (["name"], {}), (["--facility"], {"required": True}), (["--timezone"], {"default": "UTC"}), (["--interval"], {"type": int, "default": 600}))
    cmd(
        "add-sensor", add_sensor, (["station"], {}), (["code"], {}), (["name"], {}), (["--location"], {"choices": ("reference", "exposed", "environment"), "required": True}),
        (["--quantity"], {"required": True}), (["--unit"], {"required": True}), (["--min"], {"type": float}), (["--max"], {"type": float}), (["--max-step"], {"type": float}),
    )
    cmd("provision-device", provision_device, (["station"], {}), (["device"], {}), (["--rotate"], {"action": "store_true"}))
    cmd("archive", archive, (["--days"], {"type": int, "default": 7}))
    cmd("upload-dataset", upload_dataset, (["path"], {}))
    cmd("check-services", check_services)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
