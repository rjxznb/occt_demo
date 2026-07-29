# Node Bridge String Parameter Design

## Goal

Allow the standalone OCCT renderer to forward the typed parameter values required by the current parameterized window resources. The affected UE-derived rules are `140302` (`挡板`), `140e02` (arc option), and `140f` (`类型`). The remote conversion service already accepts these string values; the local Node bridge currently rejects them before forwarding.

## Scope

- Change only `C:\Users\User\Desktop\parametric-lab\backend` and OCCT verification artifacts.
- Do not change or deploy `cad_plugin` in this step.
- Keep the existing endpoint, request shape, response shape, URL validation, parameter count limit, and parameter-name limit.

## Request Contract

Each `parameters` entry remains `{ name, value }`.

- `name` must remain a non-empty string of at most 128 UTF-8 bytes.
- `value` may be either:
  - a finite JavaScript number; or
  - a non-empty string of at most 1024 UTF-8 bytes.
- Booleans, `null`, arrays, objects, empty strings, oversized strings, `NaN`, and infinities remain invalid.
- A request may still contain at most 64 parameters.

The bridge forwards accepted values without coercion. In particular, numeric-looking strings remain strings so option parameters retain their model semantics.

## Error Handling and Security

Invalid requests continue to return HTTP 400 with the existing safe `INVALID_ARGUMENT` envelope. Logs continue to contain only method/status/elapsed time/byte count/error code and never include parameter values or resource URLs.

## Testing

Backend tests will prove that:

1. Representative string parameters are accepted and forwarded unchanged beside numeric parameters.
2. Empty and oversized strings, booleans, objects, arrays, and `null` are rejected without an upstream call.
3. Existing numeric, response-size, timeout, decompression, and log-redaction tests remain green.

After restarting the local backend, the OCCT combined fixture will be reloaded. Success requires no content failures for `140302`, `140e02`, or `140f`, while all existing unit tests and the 3D build remain green.

## Deferred CAD Work

The CAD C++ bridge still has a numeric-only parameter structure. It will need an equivalent typed-value protocol change during the later CAD migration, but that project remains untouched in this step.
