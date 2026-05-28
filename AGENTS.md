# AGENTS.md instructions for gsb-cli

## Repository Role

This repository is the npm-distributed `gsb-cli` client. It does not own the GSB
platform server or web UI. The platform/framework repository is the sibling:

```text
/Users/bytedance/Downloads/2.chatbuy_eval/chatbuy_gsb_eval_framework
```

This repository owns:

- CLI source under `src/`.
- Generated publish output under `dist/`.
- npm packaging in `package.json` and `package-lock.json`.
- Public CLI docs in `README.md` and `docs/api-contract.md`.
- The bundled Agent skill under `skills/gsb-eval/`.
- npm `postinstall` skill auto-install behavior under `scripts/postinstall.mjs`.

## Platform Capability Parity

Whenever ChatBuy GSB platform capabilities or HTTP API contracts change, update
this CLI and the bundled `gsb-eval` skill in the same change set so Agent
workflows match the platform.

Minimum sync checklist:

1. Update `src/` command behavior and API assumptions.
2. Update tests under `test/`.
3. Run `npm run build` so `dist/` matches source.
4. Update `README.md`.
5. Update `docs/api-contract.md`.
6. Update `skills/gsb-eval/SKILL.md` and relevant files under
   `skills/gsb-eval/references/`.
7. Run `npm test`, or explicitly document why it could not be run.

Do not document a platform capability in the skill unless the CLI command exists
or the skill clearly states that the action requires direct platform access.

## Packaging And Skill Rules

- `npm install` should ship the same skill that Agents are expected to use.
- Keep `package.json` `files` aligned with any new bundled skill or postinstall
  files.
- If command syntax changes, update CLI help, README examples, bundled skill
  examples, and tests together.
- If version-check behavior changes, ensure `--json` output remains machine
  parseable and is not polluted by human update notices.
