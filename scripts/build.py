#!/usr/bin/env python3
"""Build a reproducible, dependency-free Zotero XPI."""
import json
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
source = root / "addon"
manifest = json.loads((source / "manifest.json").read_text())
destination = root / "dist" / f"zotero-explain-{manifest['version']}.xpi"
destination.parent.mkdir(exist_ok=True)
with ZipFile(destination, "w", compression=ZIP_DEFLATED) as archive:
    for path in sorted(source.rglob("*")):
        if path.is_file():
            entry = ZipInfo(path.relative_to(source).as_posix(), date_time=(2026, 9, 27, 0, 0, 0))
            entry.compress_type = ZIP_DEFLATED
            entry.external_attr = 0o644 << 16
            archive.writestr(entry, path.read_bytes())
print(destination)
