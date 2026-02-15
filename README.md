# CoCo
CoCo (Code Companion) For Ableton Live — functional MIDI pipeline DSL.

## Pipeline

Commands are separated by `;`. One value (array of notes) flows through: each step is a function `notes => notes`. I/O only at the edges.

- **Source:** `read <track> <slot>` — loads notes from the clip (ignores pipeline input).
- **Sink:** `write <track> <slot>` or `overwrite <track> <slot>` — writes current notes to the clip, then passes notes through.
- **Transforms:** pure `notes => notes` (see below).

Initial value is `[]`. So the first step should usually be `read 0 0` to load a clip.

## Transforms

**Primitives (function in backticks):**

- `map \`(note, index) => newNote\`` — per-note mapping.
- `flatMap \`(note, index) => arrayOfNotes\`` — one note can become many; result is flattened.
- `filter \`(note, index) => boolean\`` — keep notes that return true.
- `sort \`(a, b) => number\`` — comparator (negative / zero / positive).

Wrap the whole function in backticks so it parses as one argument.

**Aliases (built-in, no backticks):**

- `subdivide N` — split each note into N notes of equal duration (N from 1 to 256).

**Shorthand (single token):**

- One-letter field: `p` pitch, `s` start_time, `d` duration, `v` velocity.
- Op: `+` offset, `*` scale.
- Examples: `p+12` (transpose up 12), `v*0.8` (scale velocity), `s*2`, `d*2`.

## Example

```text
read 0 0 ; filter `(n,i)=>i%2===0` ; p+12 ; v*0.8 ; overwrite 0 0
```

Subdivide each note into three, then write back:

```text
read 0 0 ; subdivide 3 ; overwrite 0 0
```

Or without shorthand:

```text
read 0 0 ; map `(n)=>({...n,pitch:n.pitch+12})` ; overwrite 0 0
```

## Note shape

Each note: `{ pitch, start_time, duration, velocity }`. Same as Live’s clip notes.
