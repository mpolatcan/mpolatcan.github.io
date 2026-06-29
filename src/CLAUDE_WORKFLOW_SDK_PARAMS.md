# Workflow `.js` SDK — Parameters & Signatures (from binary internals)

> Read directly out of Claude Code **v2.1.193** (`~/.local/share/claude/versions/2.1.193`). Line numbers refer to a locally beautified extract of the embedded bundle. This is the *runtime-truth* parameter list — what the host code actually reads — not the public docs.

## Function signatures (embedded SDK literal, verbatim)

The binary carries its own signature block (the same text the tool exposes). Reproduced:

```ts
agent(prompt: string, opts?: {
  label?: string, phase?: string, schema?: object, model?: string,
  effort?: string, isolation?: 'worktree' /* | 'remote' (gated) */, agentType?: string
}): Promise<any>

pipeline(items, stage1, stage2, ...): Promise<any[]>      // stages: (prevResult, originalItem, index) => any
parallel(thunks: Array<() => Promise<any>>): Promise<any[]>
phase(title: string): void
log(message: string): void
workflow(nameOrRef: string | { scriptPath: string }, args?: any): Promise<any>
```

## `agent()` opts — the complete, runtime-read set

The host reads more fields than the public docs list. Two code paths touch opts:
- **Boundary clone list** (`Ozp`, line 6015) — the fields serialized for the opts echo: `["schema","model","effort","isolation","agentType"]`.
- **Scheduler reads** (line 6182, 6220, 6285) — additionally read `label`, `phase`, `stallMs` off the opts object.

| Option | Type | Default | Source | Notes |
|--------|------|---------|--------|-------|
| `label` | string | first 60 chars of prompt | 6182 | `String(label).replace(/\s+/g,' ').trim()` for display. |
| `phase` | string | current phase `I` | 6182 | Resolved to a phase index `P(phase)`. |
| `schema` | object (JSON Schema) | — | 6015 | Forces the `StructuredOutput` tool; `requiresStructuredOutput` set when present (6348). |
| `model` | string | `N.options.mainLoopModel` | 6190/6220/6291 | **Default is the main-loop (session) model** — confirms `opts.model` is the only model input at agent level. |
| `effort` | `'low'｜'medium'｜'high'｜'xhigh'｜'max'` | inherits session | 6285 | Normalized by `FB(effort)`; if defined, merged into the agent's options as `{...opts, effort}`. **No enum validation** — `FB` just normalizes/passes. |
| `isolation` | `'worktree'｜'remote'` | none | 6220/6223/6292 | `'worktree'` → fresh git worktree + injected prompt. **`'remote'` is recognized but THROWS**: `agent({isolation:'remote'}) is not available in this build`. |
| `agentType` | string | default workflow subagent | 6247 | Resolved against `N.options.agentDefinitions.activeAgents`; unknown → hard error listing available agents. |
| `stallMs` | number | **180000** (`Wzp`) | 6182 | **UNDOCUMENTED.** Per-agent stall timeout in ms: `re?.stallMs != null ? Number(re.stallMs) : 180000`. How long an agent may go without progress before it's treated as stalled. |

> Unknown keys are dropped silently because only the fields above are read. `effort` accepts anything (lenient); `agentType`/`isolation` are validated (strict) — matching the black-box findings.

### `isolation:'remote'` (gated)

```js
if (re?.isolation === "remote")
  throw Error("agent({isolation:'remote'}) is not available in this build");
```

The runtime knows a third execution mode (remote cloud agent) but it is compiled off in this build. Only `'worktree'` is live locally.

## Runtime constants (line 6707 + others)

| Constant | Value | Meaning |
|----------|-------|---------|
| agent lifetime cap (`qol`) | **1000** | Total `agent()` calls per run. Exceeding → `Workflow agent() call cap reached (1000) …` |
| concurrency (`Lzp`) | `Math.min(16, Math.max(2, cpus-2))` | Max simultaneous agents. Floor 2, ceiling 16, else `cpus-2`. (line 6099, fed `os.cpus().length`) |
| `stallMs` default (`Wzp`) | **180000** ms | Per-agent no-progress timeout |
| vm sync timeout (`AGn`) | **30000** ms | `runInContext` synchronous-slice cap (awaits excluded) |
| preview truncation (`Fol`) | **400** chars | Label / result / prompt preview cutoff |
| array boundary cap | **4096** | Max array length carried across the VM membrane in one call |
| `Nzp` | 50 | internal batch constant |

### Concurrency, exactly

```js
function Lzp(e) { return Math.min(16, Math.max(2, e - 2)) }
// e = os.cpus().length
```

So on a machine with N cores: `min(16, max(2, N-2))`. The public "min(16, cpu-2)" is right except it also has a **floor of 2** (a 1–4 core box still gets ≥2 concurrent).

## `pipeline()` / `parallel()` enforcement

- `pipeline()` validates every stage is a function (line 6663): `pipeline() stages must be functions: pipeline(items, item => ..., result => ...)`.
- Both enforce the 4096 array cap inside the boundary cloner (catchable).
- `parallel()` thunk errors become `null` only for **async** rejections; a synchronous throw escapes the `.map` and fails the run (see internals doc §6).

## The agent cap message (full)

```
Workflow agent() call cap reached (1000). This usually means a loop using
budget.remaining() never terminates because no token budget was set —
remaining() returns Infinity when budget.total is null. Add a hard iteration
cap to the loop, or pass a [budget] …
```

Confirms the documented guidance: guard `while` loops on `budget.total`, because `remaining()` is `Infinity` with no budget and the loop would run straight into the 1000-agent backstop.

## Net additions vs the public SDK

| Finding | Status |
|---------|--------|
| `stallMs?: number` opt (default 180000) | **undocumented** — real, read at line 6182 |
| `isolation: 'remote'` value | **recognized but gated** ("not available in this build") |
| concurrency has a **floor of 2** | refines `min(16, cpu-2)` → `min(16, max(2, cpu-2))` |
| `model` default = `mainLoopModel` | confirms session model; `meta.model` is not threaded here |
| preview/truncation at 400 chars | label/result previews are clipped at 400 |
| vm sync timeout = 30000 ms | only synchronous slices are bounded |
