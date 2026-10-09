import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The build must work offline: fonts are self-hosted in src/app/fonts.
    rules: {
      "no-restricted-imports": ["error", { paths: [{ name: "next/font/google", message: "Use next/font/local with a file in src/app/fonts (next/font/google fetches at build time)." }] }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
