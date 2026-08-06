#!/usr/bin/env python3
"""Fetch public listing pages and store readable text + structured data + links.

Runs inside GitHub Actions (runner has open internet). Reads
villa-zoektocht-spanje/tools/urls.txt: optional first line "batch=<label>",
remaining lines URLs. Writes villa-zoektocht-spanje/fetched/<batch>/NN.txt
"""
import os
import re
import html
import gzip
import time
import urllib.request
from urllib.parse import urljoin

_lines = []
_batch = "b1"
with open(os.path.join("villa-zoektocht-spanje", "tools", "urls.txt"), encoding="utf-8") as fh:
    for ln in fh:
        ln = ln.strip()
        if not ln or ln.startswith("#"):
            continue
        if ln.startswith("batch="):
            _batch = ln.split("=", 1)[1].strip() or _batch
        else:
            _lines.append(ln)
URLS = _lines
BATCH = _batch
OUTDIR = os.path.join("villa-zoektocht-spanje", "fetched", BATCH)
os.makedirs(OUTDIR, exist_ok=True)

UAS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
]

BASE_HDRS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-GB,en;q=0.9,nl;q=0.8,es;q=0.7",
    "Accept-Encoding": "gzip",
    "Cache-Control": "no-cache",
}


def fetch(url):
    last_err = None
    for ua in UAS:
        hdrs = dict(BASE_HDRS)
        hdrs["User-Agent"] = ua
        req = urllib.request.Request(url, headers=hdrs)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    data = gzip.decompress(data)
                return r.status, r.geturl(), data.decode("utf-8", "ignore")
        except Exception as e:  # retry with next UA
            last_err = e
            time.sleep(2)
    raise last_err


def clean_text(fragment):
    t = re.sub(r"<[^>]+>", " ", fragment)
    t = html.unescape(t)
    return re.sub(r"\s+", " ", t).strip()


for i, u in enumerate(URLS, 1):
    name = os.path.join(OUTDIR, f"{i:02d}.txt")
    try:
        status, final_url, s = fetch(u)
    except Exception as e:
        with open(name, "w", encoding="utf-8") as f:
            f.write(f"URL: {u}\nERROR: {e!r}\n")
        continue

    title = re.search(r"<title[^>]*>([\s\S]*?)</title>", s, re.I)
    metadesc = re.search(
        r'<meta[^>]+(?:name|property)=["\'](?:description|og:description)["\'][^>]+content=["\']([^"\']*)', s, re.I
    )
    lds = re.findall(r"<script[^>]+application/ld\+json[^>]*>([\s\S]*?)</script>", s, re.I)

    links_raw = re.findall(r"<a[^>]+href=[\"\']([^\"\'#]+)[\"\'][^>]*>([\s\S]*?)</a>", s, re.I)
    seen = set()
    links = []
    for href, txt in links_raw:
        absu = urljoin(final_url, href.strip())
        if absu in seen:
            continue
        seen.add(absu)
        if re.search(r"propert|villa|for-sale|te-koop|/prop|inmueble|chalet|/r/|ref=|detail|/a-\d|huis", absu, re.I):
            links.append(absu + " | " + clean_text(txt)[:140])

    body = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>|<!--[\s\S]*?-->", " ", s, flags=re.I)
    body = re.sub(r"<(br|/p|/div|/li|/h[1-6]|/tr|/section|/article)[^>]*>", "\n", body, flags=re.I)
    body = re.sub(r"<[^>]+>", " ", body)
    body = html.unescape(body)
    body = re.sub(r"[ \t\r\xa0]+", " ", body)
    body = re.sub(r"\n[ ]*", "\n", body)
    body = re.sub(r"\n{2,}", "\n", body)

    out = [
        f"URL: {u}",
        f"FINAL_URL: {final_url}",
        f"HTTP: {status}",
        f"TITLE: {clean_text(title.group(1)) if title else ''}",
        f"METADESC: {html.unescape(metadesc.group(1)) if metadesc else ''}",
    ]
    for ld in lds[:6]:
        out.append("LDJSON: " + re.sub(r"\s+", " ", ld).strip()[:8000])
    out.append("LINKS (property-like):")
    out.extend(links[:250])
    out.append("BODY:")
    out.append(body[:60000])
    with open(name, "w", encoding="utf-8") as f:
        f.write("\n".join(out))
    time.sleep(1.5)

print(f"done: {len(URLS)} urls -> {OUTDIR}")
