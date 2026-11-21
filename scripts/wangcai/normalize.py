"""Normalise harvested packages: drop the hand-made mask rects and let the
parameter cleanup layers do the erasing (that is how the studio renders)."""
import json
import os
import sys

DIR = sys.argv[1] if len(sys.argv) > 1 else "out/templates"

changed = 0
for name in sorted(os.listdir(DIR)):
    if not name.endswith(".haishen.json"):
        continue
    path = os.path.join(DIR, name)
    with open(path, encoding="utf-8") as fh:
        pkg = json.load(fh)
    doc = pkg["doc"]
    keep = []
    dropped = 0
    for layer in doc["layers"]:
        if layer["type"] == "rect" and layer.get("isMask") and str(layer.get("name", "")).startswith("遮罩"):
            dropped += 1
            continue
        keep.append(layer)
    if dropped:
        doc["layers"] = keep
        changed += 1
    for param in doc["parameters"]:
        cleanup = param.get("cleanup")
        if cleanup and cleanup.get("mode") == "solid":
            cleanup["follow"] = False
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(pkg, fh, ensure_ascii=False, separators=(",", ":"))

print("normalised:", changed, "packages; mask layers removed")
