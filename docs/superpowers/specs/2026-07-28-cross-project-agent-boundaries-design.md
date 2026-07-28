# Cross-project agent boundaries design

## Goal

Record the established OCCT/CAD/runtime-cache ownership rules in the OCCT repository so future agents do not edit the wrong source of truth or accidentally commit the CAD project.

## Location

Create only `D:\occt_demo\AGENTS.md`. Do not create or modify an `AGENTS.md` under `C:\Users\User\Desktop\cad_plugin`.

## Rules

- Maintain 3D/VR frontend source, frontend tests, and frontend builds in `D:\occt_demo` or its task-specific worktree.
- Maintain CAD native C++ bridge and WebView integration code in `C:\Users\User\Desktop\cad_plugin` only when the task requires native integration.
- Treat `cad_plugin\build_resource\PluginResource\html\renderer` as a deployment copy of OCCT build output, not as the frontend source of truth.
- Synchronize the same build output to `C:\Users\User\AppData\Local\ke_arx_cache\2021\PluginResource\html\renderer`, because AutoCAD reads the runtime files there.
- Verify deployed entry files reference the current hashed bundles and verify copied bundle hashes.
- Never stage, commit, push, reset, or discard changes in the CAD repository unless the user explicitly changes this rule.
- Preserve unrelated dirty CAD files and do not delete old generated assets unless the user explicitly requests cleanup.

## Scope

The instruction applies recursively to work performed under the OCCT repository. It documents cross-project actions without placing a rule file in the CAD repository.
