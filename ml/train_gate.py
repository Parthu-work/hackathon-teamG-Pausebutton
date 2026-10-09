"""Train the fast-gate scam classifier and export it for the TypeScript scorer.

Run from the project root:  ml/.venv/bin/python -I ml/train_gate.py [--max-features N]

Inputs (from ml/prepare-corpus.ts):
  ml/build/corpus.jsonl       {norm, label, lang, source}
  ml/build/eval_inputs.jsonl  {id, kind, norm, label, family}
Outputs:
  src/data/gate-model.json                         model for src/lib/check/gate.ts
  src/lib/check/__fixtures__/gate-parity.json      50 messages for the TS parity test
  ml/build/report.json                             metrics and per-message results

Tokenisation must stay identical to src/lib/check/gate.ts.
"""

import argparse
import json
import math
import random
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import confusion_matrix, precision_recall_fscore_support, roc_auc_score
from sklearn.model_selection import GridSearchCV, StratifiedKFold, train_test_split
from sklearn.pipeline import FeatureUnion, Pipeline

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "ml" / "build"
MODEL_OUT = ROOT / "src" / "data" / "gate-model.json"
FIXTURES_OUT = ROOT / "src" / "lib" / "check" / "__fixtures__" / "gate-parity.json"
SEED = 42
C_GRID = [0.5, 1, 2, 4]
PLACEHOLDERS = {"xurl", "xhandle", "xamount", "xphone", "xnum"}
SOURCES = [
    {"name": "anmolshrivastav/scam_ham_india_14_languages", "licence": "MIT",
     "url": "https://huggingface.co/datasets/anmolshrivastav/scam_ham_india_14_languages"},
    {"name": "Ridham115/indian-scam-sms-synthetic-audited", "licence": "CC BY 4.0",
     "url": "https://huggingface.co/datasets/Ridham115/indian-scam-sms-synthetic-audited"},
    {"name": "Pause Button team seeds (synthetic)", "licence": "project", "url": "ml/seeds/team_seeds.jsonl"},
]


# ---------- tokenisation (mirror of src/lib/check/gate.ts) ----------

def tokenize(norm):
    tokens, current = [], []
    for ch in norm:
        if unicodedata.category(ch)[0] in "LNM":
            current.append(ch)
        elif current:
            tokens.append("".join(current))
            current = []
    if current:
        tokens.append("".join(current))
    return tokens


def word_features(norm):
    tokens = tokenize(norm)
    out = [t for t in tokens if len(t) >= 2]
    out.extend(f"{a} {b}" for a, b in zip(tokens, tokens[1:]))
    return out


def char_features(norm):
    out = []
    for token in tokenize(norm):
        p = f" {token} "
        for n in (3, 4, 5):
            out.extend(p[i:i + n] for i in range(len(p) - n + 1))
    return out


# ---------- model ----------

def build_pipeline(max_features):
    def vec(analyzer):
        return TfidfVectorizer(analyzer=analyzer, lowercase=False, max_features=max_features, min_df=2,
                               sublinear_tf=True, smooth_idf=True, norm="l2")
    features = FeatureUnion([("word", vec(word_features)), ("char", vec(char_features))])
    return Pipeline([("features", features),
                     ("clf", LogisticRegression(class_weight="balanced", max_iter=2000))])


def sig6(x):
    return float(f"{x:.6g}")


def export_model(pipe, meta):
    union = pipe.named_steps["features"]
    clf = pipe.named_steps["clf"]
    coef = clf.coef_[0]
    blocks, offset = {}, 0
    for name, vec in union.transformer_list:
        terms = [None] * len(vec.vocabulary_)
        for term, i in vec.vocabulary_.items():
            terms[i] = term
        n = len(terms)
        blocks[name] = {"terms": terms, "idf": [sig6(v) for v in vec.idf_],
                        "coef": [sig6(v) for v in coef[offset:offset + n]]}
        offset += n
    assert offset == len(coef)
    return {"version": 1, **meta, "intercept": float(clf.intercept_[0]), "word": blocks["word"],
            "char": blocks["char"]}


class JsonGate:
    """Scores from the exported JSON exactly as gate.ts does (same order of operations)."""

    def __init__(self, model):
        self.intercept = model["intercept"]
        self.word = {t: (i, c) for t, i, c in zip(model["word"]["terms"], model["word"]["idf"], model["word"]["coef"])}
        self.char = {t: (i, c) for t, i, c in zip(model["char"]["terms"], model["char"]["idf"], model["char"]["coef"])}

    @staticmethod
    def _block(features, lookup):
        counts = {}
        for f in features:
            if f in lookup:
                counts[f] = counts.get(f, 0) + 1
        values, sum_sq = {}, 0.0
        for term, count in counts.items():
            v = (1 + math.log(count)) * lookup[term][0]
            values[term] = v
            sum_sq += v * v
        norm = math.sqrt(sum_sq)
        return {t: v / norm for t, v in values.items()}

    def score(self, norm):
        word = self._block(word_features(norm), self.word)
        char = self._block(char_features(norm), self.char)
        s = self.intercept
        for t, v in word.items():
            s += self.word[t][1] * v
        for t, v in char.items():
            s += self.char[t][1] * v
        top = sorted(((self.word[t][1] * v, t) for t, v in word.items()
                      if self.word[t][1] * v > 0 and not all(w in PLACEHOLDERS for w in t.split(" "))), reverse=True)
        return 1 / (1 + math.exp(-s)), [t for _, t in top[:5]]


# ---------- helpers ----------

def read_jsonl(path):
    with path.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def binary_metrics(y, prob, threshold=0.5):
    pred = (np.asarray(prob) >= threshold).astype(int)
    p, r, f, _ = precision_recall_fscore_support(y, pred, average="binary", zero_division=0)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    return {"precision": round(float(p), 4), "recall": round(float(r), 4), "f1": round(float(f), 4),
            "accuracy": round(float((tp + tn) / len(y)), 4), "falsePositiveRate": round(float(fp / max(fp + tn, 1)), 4),
            "tp": int(tp), "fp": int(fp), "tn": int(tn), "fn": int(fn)}


def pick_fixture_rows(rows, n=50):
    """Round-robin over (lang, label) groups so every language and both labels appear."""
    rng = random.Random(SEED)
    groups = defaultdict(list)
    for r in rows:
        groups[(r["lang"], r["label"])].append(r)
    for g in groups.values():
        rng.shuffle(g)
    picked, keys = [], sorted(groups)
    while len(picked) < n and any(groups.values()):
        for k in keys:
            if groups[k] and len(picked) < n:
                picked.append(groups[k].pop())
    return picked


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-features", type=int, default=25000, help="per block (word and char)")
    args = parser.parse_args()

    corpus = read_jsonl(BUILD / "corpus.jsonl")
    eval_inputs = read_jsonl(BUILD / "eval_inputs.jsonl")
    prepare_stats = json.loads((BUILD / "prepare_stats.json").read_text(encoding="utf-8"))
    strata = [f"{r['label']}|{r['source']}" for r in corpus]
    train, held = train_test_split(corpus, test_size=0.15, stratify=strata, random_state=SEED)
    x_train, y_train = [r["norm"] for r in train], np.array([r["label"] for r in train])
    x_held, y_held = [r["norm"] for r in held], np.array([r["label"] for r in held])
    print(f"corpus {len(corpus)} rows -> train {len(train)}, held-out {len(held)}")

    search = GridSearchCV(build_pipeline(args.max_features), {"clf__C": C_GRID}, scoring="f1",
                          cv=StratifiedKFold(5, shuffle=True, random_state=SEED), n_jobs=1, refit=True)
    search.fit(x_train, y_train)
    cv_f1 = {str(c): round(float(s), 4) for c, s in zip(C_GRID, search.cv_results_["mean_test_score"])}
    best_c = search.best_params_["clf__C"]
    pipe = search.best_estimator_
    print(f"5-fold CV F1 by C: {cv_f1} -> C = {best_c}")

    held_prob = pipe.predict_proba(x_held)[:, 1]
    metrics = binary_metrics(y_held, held_prob)
    metrics["rocAuc"] = round(float(roc_auc_score(y_held, held_prob)), 4)
    thresholds = {str(t): binary_metrics(y_held, held_prob, t) for t in (0.2, 0.35, 0.5, 0.65, 0.8)}
    slices = {}
    for key in ("source", "lang"):
        for value in sorted({r[key] for r in held}):
            idx = [i for i, r in enumerate(held) if r[key] == value]
            slices[f"{key}={value}"] = binary_metrics(y_held[idx], held_prob[idx])

    counts = Counter((r["source"], "scam" if r["label"] else "safe") for r in corpus)
    by_source = {s: {"scam": counts[(s, "scam")], "safe": counts[(s, "safe")]} for s in sorted({r["source"] for r in corpus})}
    lang_counts = Counter((r["lang"], "scam" if r["label"] else "safe") for r in corpus)
    by_lang = {l: {"scam": lang_counts[(l, "scam")], "safe": lang_counts[(l, "safe")]} for l in sorted({r["lang"] for r in corpus})}
    created_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    model = export_model(pipe, {"createdAt": created_at})
    model["training"] = {"rows": len(corpus), "trainRows": len(train), "heldOutRows": len(held), "C": best_c,
                         "bySource": by_source, "byLang": by_lang, "heldOutMetrics": metrics, "sources": SOURCES}

    # ---- parity: the JSON re-implementation must match sklearn ----
    gate = JsonGate(model)
    json_held = np.array([gate.score(x)[0] for x in x_held])
    max_diff = float(np.max(np.abs(json_held - held_prob)))
    print(f"parity: max |json - sklearn| on held-out = {max_diff:.2e}")
    assert max_diff < 1e-3, f"exported model does not match sklearn (max diff {max_diff})"

    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)
    MODEL_OUT.write_text(json.dumps(model, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    size = MODEL_OUT.stat().st_size
    print(f"wrote {MODEL_OUT.relative_to(ROOT)} ({size / 1e6:.2f} MB, {len(model['word']['terms'])} word + "
          f"{len(model['char']['terms'])} char terms)")
    if size > 5e6:
        print(f"WARNING: model is over 5 MB; rerun with a smaller --max-features (now {args.max_features})")

    fixtures = [{"norm": r["norm"], "probability": gate.score(r["norm"])[0]} for r in pick_fixture_rows(held)]
    FIXTURES_OUT.parent.mkdir(parents=True, exist_ok=True)
    FIXTURES_OUT.write_text(json.dumps({"createdAt": created_at, "messages": fixtures}, ensure_ascii=False, indent=1) + "\n",
                            encoding="utf-8")
    print(f"wrote {FIXTURES_OUT.relative_to(ROOT)} ({len(fixtures)} messages)")

    # ---- app test set and examples ----
    eval_rows = []
    for e in eval_inputs:
        prob, top = gate.score(e["norm"])
        eval_rows.append({**e, "probability": round(prob, 4), "topTerms": top})
    eval_y = np.array([e["label"] for e in eval_rows])
    eval_metrics = binary_metrics(eval_y, [e["probability"] for e in eval_rows])

    report = {"createdAt": created_at, "prepare": prepare_stats, "rows": len(corpus), "train": len(train),
              "heldOut": len(held), "bySource": by_source, "byLang": by_lang, "cvF1ByC": cv_f1, "C": best_c,
              "heldOutMetrics": metrics, "heldOutByThreshold": thresholds, "heldOutSlices": slices,
              "parityMaxDiff": max_diff, "modelBytes": size, "wordTerms": len(model["word"]["terms"]),
              "charTerms": len(model["char"]["terms"]), "appEvalMetrics": eval_metrics, "appEval": eval_rows}
    (BUILD / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # ---- readable summary ----
    print(f"\nheld-out ({len(held)} rows, threshold 0.5): precision {metrics['precision']}  recall {metrics['recall']}  "
          f"F1 {metrics['f1']}  AUC {metrics['rocAuc']}  FPR {metrics['falsePositiveRate']}")
    for name, m in slices.items():
        print(f"  {name:<28} n={m['tp'] + m['fp'] + m['tn'] + m['fn']:<4} P {m['precision']:<6} R {m['recall']:<6} "
              f"F1 {m['f1']:<6} FPR {m['falsePositiveRate']}")
    print("  by threshold: " + "  ".join(f"{t}: P {m['precision']} R {m['recall']}" for t, m in thresholds.items()))
    print(f"\napp test set + examples (threshold 0.5): precision {eval_metrics['precision']}  recall "
          f"{eval_metrics['recall']}  F1 {eval_metrics['f1']}  ({eval_metrics['fp']} false alarms, {eval_metrics['fn']} misses)")
    print(f"{'id':<8} {'family':<20} {'label':<7} {'prob':>6}  top terms")
    for e in eval_rows:
        wrong = (e["probability"] >= 0.5) != bool(e["label"])
        print(f"{e['kind'][0]}:{e['id']:<6} {e['family'][:20]:<20} {'scam' if e['label'] else 'safe':<7} "
              f"{e['probability']:>6.3f}{' !' if wrong else '  '} {', '.join(e['topTerms'][:4])}")
    print(f"\nwrote {(BUILD / 'report.json').relative_to(ROOT)}")


if __name__ == "__main__":
    main()
