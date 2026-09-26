// @ts-check
import eslintComments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores(["dist/", "coverage/"]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  eslintComments.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      // Exported functions state their contract explicitly.
      "@typescript-eslint/explicit-module-boundary-types": "error",
      // Casts are exceptional: each one needs a disable comment explaining why.
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "never" },
      ],
      "@eslint-community/eslint-comments/require-description": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      eqeqeq: "error",
      // Diagnostics go through the structured logger.
      "no-console": "error",
      "no-param-reassign": ["error", { props: true }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "ClassDeclaration, ClassExpression",
          message:
            "Prefer functions and explicit dependencies. If a class is really the best model, disable this rule with a justification.",
        },
      ],
    },
  },
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
