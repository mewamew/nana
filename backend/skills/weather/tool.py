import httpx
from datetime import date, timedelta

DESCRIPTION = "查询指定城市的天气，支持今天/明天/后天等。"
PARAMETERS = {
    "city": "城市名称，支持中英文，如 '北京'、'Tokyo'、'London'",
    "days_ahead": "查询几天后的天气：0=今天（默认），1=明天，2=后天，以此类推（最多7天）",
}

WMO_CODES = {
    0: "晴天", 1: "基本晴朗", 2: "局部多云", 3: "阴天",
    45: "雾", 48: "冻雾",
    51: "小毛毛雨", 53: "中毛毛雨", 55: "大毛毛雨",
    61: "小雨", 63: "中雨", 65: "大雨",
    71: "小雪", 73: "中雪", 75: "大雪", 77: "雪粒",
    80: "小阵雨", 81: "中阵雨", 82: "强阵雨",
    85: "小阵雪", 86: "大阵雪",
    95: "雷暴", 96: "雷暴伴小冰雹", 99: "雷暴伴大冰雹",
}

CN_TO_EN = {
    "伦敦": "London", "巴黎": "Paris", "纽约": "New York City",
    "洛杉矶": "Los Angeles", "芝加哥": "Chicago", "旧金山": "San Francisco",
    "东京": "Tokyo", "大阪": "Osaka", "首尔": "Seoul",
    "悉尼": "Sydney", "墨尔本": "Melbourne", "迪拜": "Dubai",
    "新加坡": "Singapore", "曼谷": "Bangkok", "莫斯科": "Moscow",
    "柏林": "Berlin", "法兰克福": "Frankfurt", "马德里": "Madrid",
    "罗马": "Rome", "阿姆斯特丹": "Amsterdam", "维也纳": "Vienna",
    "多伦多": "Toronto", "温哥华": "Vancouver", "蒙特利尔": "Montreal",
    "开罗": "Cairo", "约翰内斯堡": "Johannesburg", "内罗毕": "Nairobi",
    "孟买": "Mumbai", "德里": "Delhi", "雅加达": "Jakarta",
}

DAY_LABEL = {0: "今天", 1: "明天", 2: "后天"}


def _geocode(city: str) -> dict | None:
    query = CN_TO_EN.get(city, city)
    resp = httpx.get(
        "https://geocoding-api.open-meteo.com/v1/search",
        params={"name": query, "count": 5, "language": "zh"},
        timeout=10,
    )
    resp.raise_for_status()
    results = resp.json().get("results")
    if not results:
        return None
    results.sort(key=lambda r: r.get("population") or 0, reverse=True)
    return results[0]


def run(city: str = "", days_ahead: int = 0) -> str:
    if not city:
        return "请告诉我要查询哪个城市的天气。"
    days_ahead = max(0, min(int(days_ahead), 7))
    try:
        loc = _geocode(city)
        if not loc:
            return f"找不到城市「{city}」，请检查城市名称是否正确。"
        lat, lon = loc["latitude"], loc["longitude"]
        city_name = loc.get("name", city)
        country = loc.get("country", "")
        location_str = f"{city_name}（{country}）" if country else city_name

        if days_ahead == 0:
            # 实时天气
            resp = httpx.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": lat, "longitude": lon,
                    "current": "temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code",
                    "timezone": "auto",
                },
                timeout=10,
            )
            resp.raise_for_status()
            w = resp.json()["current"]
            desc = WMO_CODES.get(w["weather_code"], f"天气码{w['weather_code']}")
            return (
                f"{location_str} 今天天气：{desc}，"
                f"气温 {w['temperature_2m']}°C（体感 {w['apparent_temperature']}°C），"
                f"湿度 {w['relative_humidity_2m']}%，风速 {w['wind_speed_10m']} km/h"
            )
        else:
            # 预报天气（daily）
            target_date = (date.today() + timedelta(days=days_ahead)).isoformat()
            resp = httpx.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": lat, "longitude": lon,
                    "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max",
                    "timezone": "auto",
                    "forecast_days": days_ahead + 1,
                },
                timeout=10,
            )
            resp.raise_for_status()
            daily = resp.json()["daily"]
            dates = daily["time"]
            if target_date not in dates:
                return f"无法获取 {target_date} 的预报数据。"
            i = dates.index(target_date)
            desc = WMO_CODES.get(daily["weather_code"][i], f"天气码{daily['weather_code'][i]}")
            t_max = daily["temperature_2m_max"][i]
            t_min = daily["temperature_2m_min"][i]
            rain_prob = daily["precipitation_probability_max"][i]
            wind = daily["wind_speed_10m_max"][i]
            day_label = DAY_LABEL.get(days_ahead, f"{days_ahead}天后")
            return (
                f"{location_str} {day_label}（{target_date}）天气预报：{desc}，"
                f"气温 {t_min}～{t_max}°C，"
                f"降水概率 {rain_prob}%，最大风速 {wind} km/h"
            )
    except httpx.HTTPStatusError as e:
        return f"查询失败（HTTP {e.response.status_code}）。"
    except Exception as e:
        return f"查询天气时出错：{e}"
