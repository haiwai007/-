"""Post-process harvested 旺财 templates: thumbnails, manifest, validation.

Usage:
  python post.py <templates_dir> <catalog_json> <out_dir>
"""
import base64
import hashlib
import io
import json
import os
import re
import sys

from PIL import Image

TEMPLATES_DIR = sys.argv[1] if len(sys.argv) > 1 else "out/templates"
CATALOG = sys.argv[2] if len(sys.argv) > 2 else "wc/allw.clean.json"
OUT_DIR = sys.argv[3] if len(sys.argv) > 3 else "out/deliver"

THUMB_MAX_H = 1024
THUMB_MAX_SIDE = 2048

# 旺财 group code -> 海神 category (created on demand by the uploader)
CODE_TO_CATEGORY = {
    "yinhang": ("yinhang", "国内银行"),
    "wangluoqianbao": ("wangluoqianbao", "网络钱包"),
    "liaotian": ("liaotian", "聊天生成"),
    "haiwaiyinhang": ("haiwaiyinhang", "海外银行"),
    "jiamihuobi": ("jiamihuobi", "加密货币"),
    "gubiao": ("gubiao", "股票证券"),
    "jipiao": ("jipiao", "机票酒店"),
    "zhengjian": ("zhengjian", "证件合成"),
    "zhongguo": ("zhongguo", "定制模拟"),
}

TYPE_ENUM = {
    "text", "order", "card", "multiline", "number", "date", "image", "color",
    "font", "fontSize", "select", "toggle", "width", "height", "x", "y",
    "rotation", "opacity",
}
PROPERTY_ENUM = {
    "text", "src", "fill", "fontFamily", "fontSize", "visible", "x", "y",
    "width", "height", "rotation", "opacity",
}
LAYER_BASE = [
    "id", "name", "type", "x", "y", "width", "height", "rotation", "opacity",
    "visible", "locked", "editable", "groupId", "layout",
]


def route_map(catalog_path):
    """template route -> (group title, group code)"""
    with open(catalog_path, encoding="utf-8") as fh:
        catalog = json.load(fh)
    routes = {}
    for group in catalog:
        for item in group.get("itme") or []:
            url = item.get("url") or ""
            if url.startswith("/images/pages/") and url not in routes:
                routes[url] = (group.get("title") or "", group.get("code") or "")
    return routes


def validate(pkg):
    """Return a list of problems; empty means the file matches the studio schema."""
    problems = []
    if pkg.get("format") != "caishen-template":
        problems.append("format")
    if pkg.get("formatVersion") != 1:
        problems.append("formatVersion")
    doc = pkg.get("doc") or {}
    if doc.get("schemaVersion") != 1:
        problems.append("schemaVersion")
    canvas = doc.get("canvas") or {}
    for key, lo, hi in (("width", 16, 8000), ("height", 16, 8000)):
        val = canvas.get(key)
        if not isinstance(val, int) or not lo <= val <= hi:
            problems.append("canvas." + key)
    if not isinstance(canvas.get("backgroundColor"), str):
        problems.append("canvas.backgroundColor")
    layers = doc.get("layers")
    if not isinstance(layers, list) or len(layers) > 2000:
        problems.append("layers")
        layers = []
    ids = set()
    for layer in layers:
        for key in LAYER_BASE:
            if key not in layer:
                problems.append("layer.%s missing" % key)
        if layer.get("id") in ids:
            problems.append("duplicate layer id " + str(layer.get("id")))
        ids.add(layer.get("id"))
        if layer.get("type") not in {"text", "image", "rect", "ellipse", "triangle", "line"}:
            problems.append("layer type " + str(layer.get("type")))
        for key in ("x", "y"):
            if not isinstance(layer.get(key), (int, float)):
                problems.append("layer." + key)
        for key in ("width", "height"):
            if not isinstance(layer.get(key), (int, float)) or layer.get(key) <= 0:
                problems.append("layer." + key)
    params = doc.get("parameters")
    if not isinstance(params, list):
        problems.append("parameters")
        params = []
    for param in params:
        if param.get("type") not in TYPE_ENUM:
            problems.append("param type " + str(param.get("type")))
        if param.get("property") not in PROPERTY_ENUM:
            problems.append("param property " + str(param.get("property")))
        if not isinstance(param.get("name"), str) or not param.get("name"):
            problems.append("param name")
        if param.get("layerId") not in ids:
            problems.append("param layerId " + str(param.get("layerId")))
        cleanup = param.get("cleanup")
        if cleanup is not None:
            rect = cleanup.get("rect") or {}
            for key in ("x", "y"):
                if not isinstance(rect.get(key), (int, float)):
                    problems.append("cleanup.rect." + key)
            for key in ("width", "height"):
                if not isinstance(rect.get(key), (int, float)) or rect.get(key) <= 0:
                    problems.append("cleanup.rect." + key)
    assets = pkg.get("assets")
    if not isinstance(assets, list) or not assets:
        problems.append("assets")
        assets = []
    if len(assets) > 200:
        problems.append("too many assets")
    for asset in assets:
        for key in ("id", "mime", "data"):
            if not isinstance(asset.get(key), str) or not asset.get(key):
                problems.append("asset." + key)
        for key in ("width", "height"):
            if not isinstance(asset.get(key), (int, float)) or asset.get(key) <= 0:
                problems.append("asset." + key)
        if not re.match(r"^image/", str(asset.get("mime"))):
            problems.append("asset mime")
        if not re.match(r"^[A-Za-z0-9+/=]+$", str(asset.get("data"))):
            problems.append("asset base64")
    return problems


def thumbnail(raw, width, height):
    img = Image.open(io.BytesIO(raw))
    img = img.convert("RGB")
    scale = min(THUMB_MAX_H / img.height, THUMB_MAX_SIDE / img.width, 1.0)
    size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
    img = img.resize(size, Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue(), size


def main():
    routes = route_map(CATALOG)
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(os.path.join(OUT_DIR, "thumbs"), exist_ok=True)
    manifest = []
    bad = []
    files = sorted(f for f in os.listdir(TEMPLATES_DIR) if f.endswith(".haishen.json"))
    for name in files:
        path = os.path.join(TEMPLATES_DIR, name)
        with open(path, encoding="utf-8") as fh:
            pkg = json.load(fh)
        problems = validate(pkg)
        key = name[: -len(".haishen.json")]
        route = "/images/pages/" + key.replace("__", "/")
        group, code = routes.get(route, ("", ""))
        cat_id, cat_label = CODE_TO_CATEGORY.get(code, ("general", "通用图文设计"))
        asset = pkg["assets"][0]
        raw = base64.b64decode(asset["data"])
        try:
            thumb, size = thumbnail(raw, asset["width"], asset["height"])
        except Exception as exc:  # pragma: no cover
            bad.append((name, ["thumbnail: %s" % exc]))
            continue
        thumb_name = key + ".thumb.png"
        with open(os.path.join(OUT_DIR, "thumbs", thumb_name), "wb") as fh:
            fh.write(thumb)
        doc = pkg["doc"]
        entry = {
            "file": name,
            "key": key,
            "route": route,
            "name": doc.get("name") or key,
            "group": group,
            "category": cat_id,
            "categoryLabel": cat_label,
            "width": doc["canvas"]["width"],
            "height": doc["canvas"]["height"],
            "parameters": len(doc["parameters"]),
            "layers": len(doc["layers"]),
            "packageBytes": os.path.getsize(path),
            "thumb": thumb_name,
            "thumbBytes": len(thumb),
            "thumbSize": list(size),
            "sha256": hashlib.sha256(open(path, "rb").read()).hexdigest()[:16],
            "problems": problems,
        }
        manifest.append(entry)
        if problems:
            bad.append((name, problems))

    with open(os.path.join(OUT_DIR, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)

    total_params = sum(m["parameters"] for m in manifest)
    print("templates      :", len(manifest))
    print("editable params:", total_params)
    print("package bytes  : %.1f MB" % (sum(m["packageBytes"] for m in manifest) / 1048576))
    print("thumbnail bytes: %.1f MB" % (sum(m["thumbBytes"] for m in manifest) / 1048576))
    print("max thumb side :", max((max(m["thumbSize"]) for m in manifest), default=0))
    print("invalid files  :", len(bad))
    for name, problems in bad[:15]:
        print("  !", name, problems[:6])
    cats = {}
    for m in manifest:
        cats[m["categoryLabel"]] = cats.get(m["categoryLabel"], 0) + 1
    print("categories     :", json.dumps(cats, ensure_ascii=False))


if __name__ == "__main__":
    main()
