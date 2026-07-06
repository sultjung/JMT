#!/usr/bin/env python3
"""Fetch nearby restaurants from Naver Local Search API and generate restaurants.js.

This script is designed for GitHub Actions. Keep NAVER_CLIENT_SECRET in GitHub
Secrets and never put it in front-end JavaScript.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import html
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "naver-query-config.json"
OUTPUT_PATH = ROOT / "restaurants.js"
API_URL = "https://openapi.naver.com/v1/search/local.json"

FOOD_POSITIVE_KEYWORDS = [
    "음식", "한식", "중식", "일식", "분식", "고기", "육류", "국밥", "찌개", "순두부", "칼국수",
    "카레", "돈까스", "돈가스", "초밥", "회", "해물", "곰탕", "설렁탕", "냉면", "면요리",
    "백반", "비빔밥", "덮밥", "샤브", "족발", "보쌈", "치킨", "양식", "이탈리아", "아시아",
    "베트남", "태국", "쌀국수", "요리주점", "술집", "곱창", "갈비", "삼겹살"
]

EXCLUDE_KEYWORDS = [
    "카페", "커피", "디저트", "베이커리", "은행", "증권", "보험", "약국", "병원", "의원", "호텔",
    "편의점", "마트", "부동산", "주차장", "공유오피스", "스터디", "미용", "네일", "피부", "헬스"
]

CATEGORY_MENU_HINTS = [
    ("국밥", "국밥 한 그릇"),
    ("순대", "순대국"),
    ("돼지", "돼지국밥"),
    ("순두부", "순두부찌개"),
    ("찌개", "찌개 정식"),
    ("백반", "백반 정식"),
    ("비빔밥", "돌솥비빔밥"),
    ("칼국수", "칼국수와 만두"),
    ("카레", "카레 정식"),
    ("돈까스", "돈까스 정식"),
    ("돈가스", "돈가스 정식"),
    ("중식", "짜장면 또는 짬뽕"),
    ("일식", "덮밥 또는 우동"),
    ("초밥", "초밥 세트"),
    ("고기", "고기류 식사"),
    ("육류", "고기류 식사"),
    ("족발", "족발/보쌈 세트"),
    ("보쌈", "보쌈 정식"),
    ("쌀국수", "쌀국수"),
    ("분식", "김밥/라면/우동 세트"),
]


def load_config() -> Dict[str, Any]:
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def naver_local_search(query: str, client_id: str, client_secret: str, display: int = 5) -> List[Dict[str, Any]]:
    params = urllib.parse.urlencode({"query": query, "display": display, "start": 1, "sort": "comment"})
    request = urllib.request.Request(f"{API_URL}?{params}")
    request.add_header("X-Naver-Client-Id", client_id)
    request.add_header("X-Naver-Client-Secret", client_secret)
    with urllib.request.urlopen(request, timeout=15) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload.get("items", [])


def strip_html(value: Any) -> str:
    text = html.unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_name(value: str) -> str:
    return re.sub(r"\s+", " ", strip_html(value)).strip()


def slugify(name: str, road_address: str = "") -> str:
    raw = f"{name}-{road_address}".encode("utf-8")
    digest = hashlib.sha1(raw).hexdigest()[:8]
    ascii_part = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return f"naver-{ascii_part or 'restaurant'}-{digest}"


def parse_coord(value: Any, axis: str) -> Optional[float]:
    """Parse Naver mapx/mapy.

    Current docs describe WGS84 coordinates. Some examples are historical and may
    be scaled integers, so this function accepts decimal degrees and 1e7-scaled
    values. Unknown coordinate formats return None instead of guessing.
    """
    try:
        num = float(str(value).strip())
    except (TypeError, ValueError):
        return None

    if axis == "lon":
        if 120 <= num <= 135:
            return num
        if 1_200_000_000 <= num <= 1_350_000_000:
            return num / 10_000_000
    if axis == "lat":
        if 30 <= num <= 45:
            return num
        if 300_000_000 <= num <= 450_000_000:
            return num / 10_000_000
    return None


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> int:
    radius = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return int(round(radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))))


def is_food_place(name: str, category: str) -> bool:
    haystack = f"{name} {category}"
    if any(keyword in haystack for keyword in EXCLUDE_KEYWORDS):
        # 술집/요리주점은 저녁 후보가 될 수 있으므로 음식 키워드가 함께 있으면 살립니다.
        if not any(keyword in haystack for keyword in ["요리주점", "호프", "이자카야", "고기", "음식"]):
            return False
    return any(keyword in haystack for keyword in FOOD_POSITIVE_KEYWORDS)


def infer_category(category: str, name: str) -> str:
    merged = f"{category} {name}"
    if any(k in merged for k in ["국밥", "순대", "곰탕", "설렁탕"]):
        return "한식/국탕류"
    if any(k in merged for k in ["순두부", "찌개", "백반", "비빔밥", "한식"]):
        return "한식"
    if any(k in merged for k in ["중식", "중국", "짜장", "짬뽕", "마라"]):
        return "중식"
    if any(k in merged for k in ["일식", "초밥", "스시", "우동", "돈까스", "돈가스", "카레"]):
        return "일식/돈까스"
    if any(k in merged for k in ["분식", "김밥", "떡볶이"]):
        return "분식"
    if any(k in merged for k in ["육류", "고기", "갈비", "삼겹", "족발", "보쌈"]):
        return "고기/회식"
    if any(k in merged for k in ["쌀국수", "베트남", "태국", "아시아"]):
        return "아시아음식"
    return category.split(">")[-1].strip() or "음식점"


def infer_recommended_menu(category: str, name: str) -> str:
    merged = f"{category} {name}"
    for keyword, menu in CATEGORY_MENU_HINTS:
        if keyword in merged:
            return menu
    return "대표 식사 메뉴"


def infer_tags(category: str, name: str, distance_m: int, lunch_price: int, dinner_price: int) -> List[str]:
    merged = f"{category} {name}"
    tags: List[str] = []
    if distance_m <= 80:
        tags.append("건물근처")
    if distance_m <= 180:
        tags.append("빠른점심")
    if lunch_price <= 12000:
        tags.append("가성비")
    if any(k in merged for k in ["한식", "국밥", "순대", "찌개", "순두부", "백반", "비빔밥"]):
        tags.extend(["한식", "팀장님취향"])
    if any(k in merged for k in ["고기", "육류", "갈비", "삼겹", "족발", "보쌈", "요리주점", "이자카야"]):
        tags.extend(["회식", "술한잔"])
    if any(k in merged for k in ["정식", "비빔밥", "일식", "돈까스", "초밥"]):
        tags.append("깔끔함")
    return sorted(set(tags))


def infer_prices(category: str, name: str) -> Tuple[int, int]:
    merged = f"{category} {name}"
    if any(k in merged for k in ["국밥", "순대", "백반", "분식", "김밥", "칼국수", "찌개", "순두부"]):
        return 11000, 16000
    if any(k in merged for k in ["비빔밥", "카레", "돈까스", "돈가스", "쌀국수", "중식"]):
        return 13000, 18000
    if any(k in merged for k in ["초밥", "스시", "샤브", "고기", "갈비", "삼겹", "족발", "보쌈", "요리주점"]):
        return 16000, 30000
    return 13000, 22000


def infer_manager_score(category: str, name: str) -> int:
    merged = f"{category} {name}"
    if any(k in merged for k in ["순대", "돼지국밥", "국밥", "순두부", "찌개"]):
        return 10
    if any(k in merged for k in ["한식", "백반", "비빔밥", "곰탕", "설렁탕", "칼국수"]):
        return 8
    if any(k in merged for k in ["고기", "족발", "보쌈"]):
        return 7
    if any(k in merged for k in ["중식", "일식", "돈까스", "카레"]):
        return 5
    return 4


def apply_manual_override(item: Dict[str, Any], overrides: Dict[str, Any]) -> Dict[str, Any]:
    override = overrides.get(item["name"])
    if not override:
        return item
    merged = {**item, **override}
    if "tags" in override:
        merged["tags"] = sorted(set(item.get("tags", []) + override["tags"]))
    return merged


def build_restaurant(item: Dict[str, Any], base: Dict[str, Any], overrides: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    name = normalize_name(item.get("title"))
    category_raw = strip_html(item.get("category"))
    road_address = strip_html(item.get("roadAddress"))
    address = strip_html(item.get("address"))

    if not name or not is_food_place(name, category_raw):
        return None

    lon = parse_coord(item.get("mapx"), "lon")
    lat = parse_coord(item.get("mapy"), "lat")
    if lat is None or lon is None:
        return None

    distance_m = haversine_m(base["lat"], base["lon"], lat, lon)
    radius = int(base.get("radiusMeters", 400))
    if distance_m > radius:
        return None

    lunch_price, dinner_price = infer_prices(category_raw, name)
    category = infer_category(category_raw, name)
    tags = infer_tags(category_raw, name, distance_m, lunch_price, dinner_price)
    alcohol_friendly = any(tag in tags for tag in ["술한잔", "회식"])
    group_friendly = alcohol_friendly or distance_m <= 250 or "한식" in tags
    good_for_dinner = alcohol_friendly or group_friendly

    result = {
        "id": slugify(name, road_address or address),
        "name": name,
        "category": category,
        "mainMenu": category_raw or category,
        "recommendedMenu": infer_recommended_menu(category_raw, name),
        "lunchPrice": lunch_price,
        "dinnerPrice": dinner_price,
        "distanceMeters": distance_m,
        "walkMinutes": max(1, int(round(distance_m / 75))),
        "tags": tags,
        "goodForLunch": True,
        "goodForDinner": bool(good_for_dinner),
        "groupFriendly": bool(group_friendly),
        "alcoholFriendly": bool(alcohol_friendly),
        "managerPreferenceScore": infer_manager_score(category_raw, name),
        "notes": "네이버 지역검색에서 자동 수집했습니다. 가격·메뉴·회식 적합도는 카테고리 기반 추정값이므로 운영 전 확인하세요.",
        "lastVisitedDate": None,
        "dislike": False,
        "favorite": False,
        "source": "naver-local-search",
        "naverLink": strip_html(item.get("link")),
        "roadAddress": road_address,
        "address": address,
        "lat": lat,
        "lon": lon,
    }
    return apply_manual_override(result, overrides)


def fallback_existing() -> List[Dict[str, Any]]:
    if not OUTPUT_PATH.exists():
        return []
    raw = OUTPUT_PATH.read_text(encoding="utf-8")
    match = re.search(r"window\.RESTAURANTS\s*=\s*(\[.*?\]);", raw, flags=re.S)
    if not match:
        return []
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError:
        return []


def write_restaurants(restaurants: List[Dict[str, Any]], meta: Dict[str, Any]) -> None:
    generated_at = dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).isoformat(timespec="seconds")
    meta = {**meta, "generatedAt": generated_at, "count": len(restaurants)}
    content = """// 자동 생성 파일입니다. scripts/fetch_naver_restaurants.py가 갱신합니다.
// 수동 수정이 필요하면 naver-query-config.json의 manualOverrides를 우선 사용하세요.

window.RESTAURANTS_META = """ + json.dumps(meta, ensure_ascii=False, indent=2) + ";\n\nwindow.RESTAURANTS = " + json.dumps(restaurants, ensure_ascii=False, indent=2) + ";\n"
    OUTPUT_PATH.write_text(content, encoding="utf-8")


def main() -> int:
    client_id = os.environ.get("NAVER_CLIENT_ID")
    client_secret = os.environ.get("NAVER_CLIENT_SECRET")
    if not client_id or not client_secret:
        print("NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 필요합니다.", file=sys.stderr)
        return 2

    config = load_config()
    base = config["base"]
    queries = config.get("queries", [])
    overrides = config.get("manualOverrides", {})

    dedup: Dict[str, Dict[str, Any]] = {}
    errors: List[str] = []

    for query in queries:
        try:
            items = naver_local_search(query, client_id, client_secret, display=5)
        except Exception as exc:  # pragma: no cover - action log visibility
            errors.append(f"{query}: {exc}")
            continue

        for raw_item in items:
            restaurant = build_restaurant(raw_item, base, overrides)
            if not restaurant:
                continue
            key = f"{restaurant['name']}|{restaurant.get('roadAddress') or restaurant.get('address')}"
            # 같은 식당이 여러 검색어에 걸리면 더 가까운 값, 더 많은 태그를 유지합니다.
            if key in dedup:
                existing = dedup[key]
                existing["tags"] = sorted(set(existing.get("tags", []) + restaurant.get("tags", [])))
                existing["distanceMeters"] = min(existing["distanceMeters"], restaurant["distanceMeters"])
                existing["walkMinutes"] = max(1, int(round(existing["distanceMeters"] / 75)))
            else:
                dedup[key] = restaurant
        time.sleep(0.2)

    restaurants = sorted(dedup.values(), key=lambda r: (r["distanceMeters"], r["name"]))

    if not restaurants:
        restaurants = fallback_existing()
        meta_source = "fallback-existing-restaurants"
    else:
        meta_source = "naver-local-search"

    meta = {
        "source": meta_source,
        "baseName": base.get("name"),
        "baseAddress": base.get("address"),
        "baseLat": base.get("lat"),
        "baseLon": base.get("lon"),
        "radiusMeters": base.get("radiusMeters", 400),
        "queries": queries,
        "errors": errors[:5],
        "notice": "가격·메뉴·단체 가능 여부는 네이버 지역검색 카테고리 기반 추정값입니다. 운영 전 확인하세요."
    }
    write_restaurants(restaurants, meta)
    print(f"Generated {len(restaurants)} restaurants into {OUTPUT_PATH}")
    if errors:
        print("Errors:")
        for error in errors:
            print(f"- {error}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
