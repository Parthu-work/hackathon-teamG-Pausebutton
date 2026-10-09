# Self-hosted fonts

Served by `next/font/local` from `src/app/layout.tsx`, so `pnpm build` needs no network.
Each file is one subset of the Google Fonts release, the same subsets the app used
through `next/font/google`:

| File | Family | Weights | Subset | License |
|---|---|---|---|---|
| `atkinson-hyperlegible-400.woff2`, `-700.woff2` | Atkinson Hyperlegible | 400, 700 | latin | `OFL-atkinsonhyperlegible.txt` |
| `bricolage-grotesque-600-800.woff2` | Bricolage Grotesque (variable) | 600–800 | latin | `OFL-bricolagegrotesque.txt` |
| `noto-sans-devanagari-400-800.woff2` | Noto Sans Devanagari (variable) | 400–800 | devanagari | `OFL-notosansdevanagari.txt` |
| `noto-sans-telugu-400-800.woff2` | Noto Sans Telugu (variable) | 400–800 | telugu | `OFL-notosanstelugu.txt` |

All four are under the SIL Open Font License 1.1; keep the license files next to the fonts.
To update one, download the subset's WOFF2 from the `fonts.googleapis.com/css2` stylesheet
and replace the file under the same name.
