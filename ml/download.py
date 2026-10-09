"""Download the two synthetic SMS datasets and write ml/build/raw_combined.jsonl.

Run from the project root:  ml/.venv/bin/python -I ml/download.py [--force]

Downloaded files are untrusted data. They are saved under ml/raw/ and only
parsed as CSV; nothing in them is executed.

Output rows: {"text", "label" (1 = scam, 0 = safe), "lang", "source"}.
"""

import argparse
import json
import random
import re
import sys
import urllib.request
from collections import Counter
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "ml" / "raw"
BUILD = ROOT / "ml" / "build"

DATASETS = {
    # MIT licence. 14 languages; we keep the four the app targets.
    "scam_ham_india_14": {
        "url": "https://huggingface.co/datasets/anmolshrivastav/scam_ham_india_14_languages/resolve/main/scam_ham_india_14_languages.csv",
        "file": "scam_ham_india_14_languages.csv",
        "labels": {"scam": 1, "ham": 0},
        "langs": {"English": "en", "Hinglish": "hinglish", "Hindi": "hi", "Telugu": "te"},
    },
    # CC BY 4.0. The `label` column already includes the audit flips.
    "synthetic_audited": {
        "url": "https://huggingface.co/datasets/Ridham115/indian-scam-sms-synthetic-audited/resolve/main/data/synthetic_audited.csv",
        "file": "synthetic_audited.csv",
        "labels": {"scam": 1, "safe": 0},
        "langs": {"en": "en", "hinglish": "hinglish", "hi": "hi", "te_en": "te_en"},
    },
}

# Telugu rows in scam_ham_india_14 end with a template counter that leaks the
# label: every scam row ends "సూచన <n>." and every ham row "సమాచారం సంఖ్య <n>.".
TELUGU_SUFFIX = re.compile(r"\s*(?:సూచన|సమాచారం సంఖ్య)\s*\d+\s*\.?\s*$")
# The same rows use defanged links ("hxxp://bank-verify.example"); refang them
# so the normaliser sees a link, as it would in a real message.
DEFANGED = re.compile(r"\bhxxp(s?)://", re.IGNORECASE)
MOJIBAKE = re.compile("�|Ã.|â€|à¤|à°|Â")
SCRIPT_CHECK = {"hi": re.compile("[ऀ-ॿ]"), "te": re.compile("[ఀ-౿]")}


def download(url: str, dest: Path, force: bool) -> None:
    if dest.exists() and not force:
        print(f"using cached {dest.relative_to(ROOT)}")
        return
    print(f"downloading {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "pause-button-ml/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = resp.read()
    dest.write_bytes(data)
    print(f"  saved {len(data):,} bytes to {dest.relative_to(ROOT)}")


def clean(text: str) -> str:
    text = TELUGU_SUFFIX.sub("", text)
    text = DEFANGED.sub(r"http\1://", text)
    return re.sub(r"\s+", " ", text).strip()


def load(source: str, spec: dict) -> "tuple[list[dict], Counter]":
    df = pd.read_csv(RAW / spec["file"], dtype=str, keep_default_na=False)
    rows, dropped = [], Counter()
    for raw_text, raw_label, raw_lang in zip(df["text"], df["label"], df["language"]):
        lang = spec["langs"].get(raw_lang.strip())
        if lang is None:
            dropped["other_language"] += 1
            continue
        label = spec["labels"].get(raw_label.strip().lower())
        if label is None:
            dropped["unknown_label"] += 1
            continue
        text = clean(raw_text)
        if len(text) < 8:
            dropped["empty_or_tiny"] += 1
        elif MOJIBAKE.search(text) or any(ord(c) < 32 for c in text):
            dropped["mojibake"] += 1
        elif lang in SCRIPT_CHECK and not SCRIPT_CHECK[lang].search(text):
            dropped["wrong_script"] += 1
        else:
            rows.append({"text": text, "label": label, "lang": lang, "source": source})
    return rows, dropped


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="re-download even if cached")
    args = parser.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    BUILD.mkdir(parents=True, exist_ok=True)

    combined = []
    rng = random.Random(7)
    for source, spec in DATASETS.items():
        download(spec["url"], RAW / spec["file"], args.force)
        rows, dropped = load(source, spec)
        combined.extend(rows)
        print(f"\n== {source}: kept {len(rows)} rows; dropped {dict(dropped)}")
        print(f"\n-- 25 random rows from {source}:")
        for r in rng.sample(rows, min(25, len(rows))):
            print(f"  [{'SCAM' if r['label'] else 'safe'} {r['lang']}] {r['text'][:200]}")

    out = BUILD / "raw_combined.jsonl"
    with out.open("w", encoding="utf-8") as f:
        for r in combined:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"\nwrote {len(combined)} rows to {out.relative_to(ROOT)}")
    counts = Counter((r["source"], r["lang"], "scam" if r["label"] else "safe") for r in combined)
    print(f"\n{'source':<20} {'lang':<9} {'scam':>6} {'safe':>6}")
    for source, lang in sorted({(s, l) for s, l, _ in counts}):
        print(f"{source:<20} {lang:<9} {counts[(source, lang, 'scam')]:>6} {counts[(source, lang, 'safe')]:>6}")


if __name__ == "__main__":
    sys.exit(main())
