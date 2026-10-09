# Fast gate

The fast gate is Pause Button's first, cheap check. It is a TF-IDF + logistic
regression model trained in Python, exported to `src/data/gate-model.json`, and
scored in plain TypeScript on the server by `src/lib/check/gate.ts` (well under
10 ms per message). It returns the probability that a message is a scam (1 = scam, 0 = safe);
the app maps that probability to SCAM / SUSPICIOUS / SAFE itself.

## Retrain

```bash
pnpm ml:setup   # once: creates ml/.venv and installs ml/requirements.txt (Python 3.9+)
pnpm ml:all     # download -> prepare -> train
pnpm vitest run src/lib/check/gate.test.ts   # TS scorer must match Python
```

| Step | Script | Output |
|---|---|---|
| `ml:download` | `ml/download.py` | `ml/raw/*.csv`, `ml/build/raw_combined.jsonl` (+ 25 sample rows per dataset printed for review) |
| `ml:prepare` | `ml/prepare-corpus.ts` | `ml/build/corpus.jsonl`, `ml/build/eval_inputs.jsonl`, `ml/build/prepare_stats.json` |
| `ml:train` | `ml/train_gate.py` | `src/data/gate-model.json`, `src/lib/check/__fixtures__/gate-parity.json`, `ml/build/report.json` |

`prepare-corpus.ts` runs every row through the app's own `normalizeForGate`
(`src/lib/check/normalize.ts`), so training and scoring see identical text. It
removes any row that equals or nearly equals (Jaccard >= 0.8 on word sets) one of
the app's test messages (`src/data/test-set.json`) or examples
(`src/data/examples.json`), plus exact duplicates, label conflicts and near
duplicates within the corpus. `train_gate.py` holds out a stratified 15% split,
picks C from [0.5, 1, 2, 4] by 5-fold CV (F1), checks that a re-implementation
of the exported JSON matches sklearn within 1e-3, and writes the parity
fixtures. Python runs with `-I`; downloaded files are only read as data.

## Data: synthetic only

Every training row is synthetic. We do not train on real people's messages.

- **Indian Multilingual Scam & Ham SMS Dataset (14 Languages)** by anmolshrivastav,
  MIT licence. <https://huggingface.co/datasets/anmolshrivastav/scam_ham_india_14_languages>.
  We use the English, Hinglish, Hindi and Telugu rows. Telugu rows end in a numbered
  suffix that gives away the label (`సూచన N` on every scam, `సమాచారం సంఖ్య N` on
  every safe row). We strip it, and turn `hxxp://` links back into `http://`.
- **Indian Scam SMS (synthetic, audited)** by Ridham115, CC BY 4.0.
  <https://huggingface.co/datasets/Ridham115/indian-scam-sms-synthetic-audited>.
  We use the `en`, `hinglish`, `hi` and `te_en` rows, normalised and deduplicated.
  Licence: <https://creativecommons.org/licenses/by/4.0/>. *Caveat:* the
  messages were written by Google Gemini and Groq-hosted `openai/gpt-oss-120b`,
  and those providers' terms apply to their outputs. For example, Gemini's terms
  restrict using its outputs to build competing models. The CC BY licence does not
  override those terms. Its card also warns that scam rows use invented domains and
  safe rows use real ones. `normalizeForGate` replaces every link with `xurl`, so
  the model never sees the domain.
- **Team seeds** (`ml/seeds/team_seeds.jsonl`), written for this project. These are
  scams the public sets miss: digital arrest, secrecy ("don't tell your family"),
  wrong-UPI refund, QR / PIN to receive, courier with drugs and task jobs. They come
  with genuine hard negatives: OTPs, fraud advisories, courier updates, UPI requests
  between friends, bills, bank transaction alerts and family chat. Phone numbers are
  masked (`+91 9XXXX XXXXX`). The prepare step gives them dummy digits so they
  normalise to `xphone`.

**Why `sidzzz07/scamshield-dataset` is excluded:** it contains real messages. Real
messages can carry real people's names, numbers and accounts, and we cannot confirm
consent or licence for them. Do not add it, or any other dataset of real messages.

Both public cards say the data is synthetic and should not be used to estimate
real-world accuracy. Treat the held-out metrics as a sanity check, not a
real-world number.

## Tokenisation spec (Python `train_gate.py` and TS `gate.ts` must match)

Input is the `normalizeForGate` string.

- **Tokens:** maximal runs of code points whose Unicode general category starts
  with L, N or M (Python `unicodedata.category(ch)[0] in "LNM"`; TS
  `/[\p{L}\p{N}\p{M}]/u`). Iterate by code point.
- **Word features:** every token of length >= 2 code points, plus bigrams
  `"a b"` of consecutive tokens from the full token list.
- **Char features:** for each token `t`, `p = " " + t + " "`. Take every
  substring of `p` of length 3, 4 and 5 (by code point).
- **Vectorisers:** separate word and char `TfidfVectorizer`s (callable
  analyzers, `max_features=25000`, `min_df=2`, `sublinear_tf`, `smooth_idf`,
  `norm="l2"`), stacked side by side, then
  `LogisticRegression(class_weight="balanced", max_iter=2000)`.
- **Scoring (TS):** per block, `tf = 1 + ln(count)` for in-vocab terms,
  `value = tf * idf`, L2-normalised over that block's in-vocab terms. Then
  `score = intercept + sum(coef * value)` over both blocks, and
  `probability = 1 / (1 + e^-score)`.

The exported JSON stores `terms`, `idf` and `coef` per block (6 significant
digits). Python 3.9 uses Unicode 13 tables, while Node uses newer ones. A few code
points added after Unicode 13 can therefore tokenise differently. These are rare in
SMS.
