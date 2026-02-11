// TODOs


// TODO more robust texteditor with syntax highlighting and autocomplete might be done using codemirror https://codemirror.net/


// TODO might be able to implement branching logic using arrays

// TODO pass functions as arguments to commands




function msg_string(s)
{
	run(s);
}

function text(s)
{
	run(s);
}

function getClip(track, clipSlot) {
	var path2 = "live_set tracks " + track + " clip_slots " + clipSlot + " clip";
	var clip = new LiveAPI(path2);
	
	if (clip.id == 0) {
		post("making new clip\n");
		var slotPath = "live_set tracks " + track + " clip_slots " + clipSlot;
		var clipSlot = new LiveAPI(slotPath);
		clipSlot.call("create_clip", 4);
		clip = new LiveAPI(path2);
	}
	
	return clip;
}

// Returns the clip at the selected track and clip slot
function readClip(notes, track, clipSlot) {
	var clip = getClip(track, clipSlot);
	
	var clipNotes = JSON.parse(clip.call("get_all_notes_extended"));
	
	return clipNotes.notes;
}

//deletes all the notes present in the clip and inserts new ones
function overwriteClip(notes, track, clipSlot) {
	var clip = getClip(track, clipSlot);
	
	var notesToClear = JSON.parse(clip.call("get_all_notes_extended", {"return":["note_id"]}));
	var idList = notesToClear.notes.map((entry) => entry.note_id);
	clip.call("remove_notes_by_id", idList);
	
	clip.call("add_new_notes", upliftNoteArray(notes));
	
	return notes;
}

function writeClip(notes, track, clipSlot) {
	var clip = getClip(track, clipSlot);
	clip.call("add_new_notes", upliftNoteArray(notes));
	
	return notes;
}


// This discards note_ids which break clip writing
function upliftNoteArray(notes) {
	var filteredNotes = notes.map(({pitch, start_time, duration, velocity}) => ({pitch, start_time, duration, velocity}));
	return {"notes": filteredNotes};
}

function mergeBranches(branches) {
	const flat = branches.flat();
	flat.sort((a, b) => (a.start_time || 0) - (b.start_time || 0));
	return flat;
}

// Single-array helpers (used by branch-mapping commands)
function singleScalePitch(i, scaleFactor) {
	return i.map(({pitch, start_time, duration, velocity}) => ({pitch: pitch * scaleFactor, start_time, duration, velocity}));
}
function singleScaleStart(i, scaleFactor) {
	return i.map(({pitch, start_time, duration, velocity}) => ({pitch, start_time: start_time * scaleFactor, duration, velocity}));
}
function singleScaleDuration(i, scaleFactor) {
	return i.map(({pitch, start_time, duration, velocity}) => ({pitch, start_time, duration: duration * scaleFactor, velocity}));
}
function singleScaleVelocity(i, scaleFactor) {
	return i.map(({pitch, start_time, duration, velocity}) => ({pitch, start_time, duration, velocity: velocity * scaleFactor}));
}
function singleOffsetPitch(i, amount) {
	return i.map(({pitch, start_time, duration, velocity}) => ({pitch: pitch + amount, start_time, duration, velocity}));
}
function singleOffsetStart(i, amount) {
	return i.map(({pitch, start_time, duration, velocity}) => ({pitch, start_time: start_time + amount, duration, velocity}));
}
function singleOffsetDuration(i, amount) {
	return i.map(({pitch, start_time, duration, velocity}) => ({pitch, start_time, duration: duration + amount, velocity}));
}
function singleOffsetVelocity(i, amount) {
	return i.map(({pitch, start_time, duration, velocity}) => ({pitch, start_time, duration, velocity: velocity + amount}));
}
function singleInvertPitch(i) {
	return i.map(({pitch, start_time, duration, velocity}) => ({pitch: 127 - pitch, start_time, duration, velocity}));
}
function singleSubdividePattern(notes, pattern) {
	return subdivideWithPattern(notes, pattern);
}
function singleFlatten(i) {
	return i;
}

const commands = {
	// i/o methods
	read: (branches, track, clipSlot) => readClip([], track, clipSlot),
	write: (branches, track, clipSlot) => {
		const merged = mergeBranches(branches);
		writeClip(merged, track, clipSlot);
		return merged;
	},
	overwrite: (branches, track, clipSlot) => {
		const merged = mergeBranches(branches);
		overwriteClip(merged, track, clipSlot);
		return merged;
	},

	merge: (branches) => mergeBranches(branches),

	// scaling methods (multiplication)
	scalePitch: (branches, scaleFactor) => ({ branches: branches.map(b => singleScalePitch(b, scaleFactor)) }),
	scaleStart: (branches, scaleFactor) => ({ branches: branches.map(b => singleScaleStart(b, scaleFactor)) }),
	scaleDuration: (branches, scaleFactor) => ({ branches: branches.map(b => singleScaleDuration(b, scaleFactor)) }),
	scaleVelocity: (branches, scaleFactor) => ({ branches: branches.map(b => singleScaleVelocity(b, scaleFactor)) }),

	// offset methods (addition)
	offsetPitch: (branches, amount) => ({ branches: branches.map(b => singleOffsetPitch(b, amount)) }),
	offsetStart: (branches, amount) => ({ branches: branches.map(b => singleOffsetStart(b, amount)) }),
	offsetDuration: (branches, amount) => ({ branches: branches.map(b => singleOffsetDuration(b, amount)) }),
	offsetVelocity: (branches, amount) => ({ branches: branches.map(b => singleOffsetVelocity(b, amount)) }),

	invertPitch: (branches) => ({ branches: branches.map(b => singleInvertPitch(b)) }),

	// splitting methods
	subdividePattern: (branches, pattern) => ({ branches: branches.map(b => singleSubdividePattern(b, pattern)) }),
	subdivide: (branches, divisions) => ({
		branches: branches.flatMap(b =>
			b.flatMap(({ pitch, start_time, duration, velocity }) => {
				const subDuration = duration / divisions;
				return Array.from({ length: divisions }, (_, i) => [{
					pitch,
					start_time: start_time + i * subDuration,
					duration: subDuration,
					velocity
				}]);
			})
		)
	}),

	flatten: (branches) => ({ branches: [mergeBranches(branches)] }),

	clear: (branches, track, clipSlot) => ({ branches: branches }),

	mapBranches: (branches, listArg) => {
		if (typeof listArg !== "string") return { branches };
		const ops = parseMapBranchesArg(listArg);
		return runMapBranches(branches, ops);
	},

	mapNote: (branches, jsString) => {
		if (typeof jsString !== "string") return { branches };
		const s = jsString.trim();
		let fn;
		if (s.indexOf("=> {") !== -1) {
			fn = new Function("note", s);
		} else {
			fn = new Function("note", "return (" + s + ");");
		}
		return {
			branches: branches.map(b =>
				b.map(note => {
					try {
						const result = fn(note);
						if (result != null && typeof result === "object" && !Array.isArray(result)) {
							return { pitch: note.pitch, start_time: note.start_time, duration: note.duration, velocity: note.velocity, ...result };
						}
						return result;
					} catch (err) {
						outlet(0, "mapNote error: " + err);
						return note;
					}
				})
			)
		};
	},
}

function subdivideWithPattern(notes, pattern) {
  const steps = pattern.length;

  return notes.flatMap(note => {
    const subDuration = note.duration / steps;

    return pattern.flatMap((on, i) => {
      if (!on) return [];

      return {
        ...note,
        start_time: note.start_time + i * subDuration,
        duration: subDuration
      };
    });
  });
}

// Split by ; only when at depth 0 (relative to segment)
function splitBySemicolonAtDepth0(s) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
    else if (c === ";" && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(s.slice(start).trim());
  return out.filter(Boolean);
}

// Split by comma only when at depth 1 (inside one level of brackets)
function splitByCommaAtDepth1(s) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
    else if (c === "," && depth === 1) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(s.slice(start).trim());
  return out.filter(Boolean);
}

// Parse mapBranches argument string "[ op1 , op2 ; op3 , ... ]" -> [ [cmd, cmd, ...], [cmd], ... ]
function parseMapBranchesArg(listStr) {
  const s = (listStr && listStr.trim()) || "";
  const inner = s.startsWith("[") && s.endsWith("]") ? s.slice(1, -1).trim() : s;
  const segments = splitByCommaAtDepth1("[" + inner + "]");
  const chains = segments.map(seg => {
    const parts = splitBySemicolonAtDepth0(seg);
    return parts.map(part => {
      const { name, args: argStrings } = splitStatement(part);
      const args = argStrings.map(parseArg);
      return { name, args };
    });
  });
  return chains;
}

function runMapBranches(branches, ops) {
  if (ops.length !== branches.length) {
    outlet(0, "mapBranches: number of operations (" + ops.length + ") must match number of branches (" + branches.length + ")");
    return { branches };
  }
  const newBranches = [];
  for (let i = 0; i < branches.length; i++) {
    let currentBranches = [branches[i]];
    const chain = ops[i];
    for (let c = 0; c < chain.length; c++) {
      const cmd = chain[c];
      const fn = commands[cmd.name];
      if (!fn) {
        outlet(0, "mapBranches: unknown command \"" + cmd.name + "\"");
        break;
      }
      const result = fn(currentBranches, ...cmd.args);
      if (result && result.branches !== undefined) {
        currentBranches = result.branches;
      } else {
        currentBranches = [result];
      }
    }
    newBranches.push(...currentBranches);
  }
  return { branches: newBranches };
}

const macros = {
  "/": ["flatten"]
};



function normalizeTokens(tokens) {
  const out = [];

  for (const t of tokens) {
    if (macros[t]) {
      out.push(...macros[t]);
    } else if (t !== "-") {
      out.push(t);
    }
  }

  return out;
}

// Split on ; only when at depth 0 (not inside [ ] or { })
function tokenize(src) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
    else if ((c === ";" || c === "\n") && depth === 0) {
      const part = src.slice(start, i).trim();
      if (part) out.push(part);
      start = i + 1;
    }
  }
  const part = src.slice(start).trim();
  if (part) out.push(part);
  return out;
}

function parseArg(arg) {
  if (typeof arg !== "string") return arg;
  if (arg.startsWith("[") || arg.startsWith("{")) {
    try {
      return JSON.parse(arg);
    } catch (e) {
      return arg;
    }
  }

  const num = Number(arg);
  if (!Number.isNaN(num)) {
    return num;
  }

  return arg;
}

// Find matching closing bracket/brace; depth counts [ { and ] }
function findMatching(s, openIndex) {
  const open = s[openIndex];
  const close = open === "[" ? "]" : "}";
  let depth = 1;
  for (let i = openIndex + 1; i < s.length; i++) {
    const c = s[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Split statement into command name and args; args respect { } and [ ] (one arg per block or word)
function splitStatement(statementStr) {
  const s = statementStr.trim();
  let i = 0;
  while (i < s.length && /\s/.test(s[i])) i++;
  if (i >= s.length) return { name: "", args: [] };
  let nameEnd = i;
  while (nameEnd < s.length && !/\s/.test(s[nameEnd])) nameEnd++;
  const name = s.slice(i, nameEnd);
  i = nameEnd;
  const args = [];
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    const c = s[i];
    if (c === "{") {
      const end = findMatching(s, i);
      if (end === -1) break;
      args.push(s.slice(i + 1, end));
      i = end + 1;
    } else if (c === "[") {
      const end = findMatching(s, i);
      if (end === -1) break;
      args.push(s.slice(i, end + 1));
      i = end + 1;
    } else {
      let start = i;
      while (i < s.length && !/\s/.test(s[i])) i++;
      args.push(s.slice(start, i));
    }
  }
  return { name, args };
}

function parse(tokens) {
  return tokens.map(t => {
    const { name, args: argStrings } = splitStatement(t);
    const args = argStrings.map(parseArg);
    return { name, args };
  });
}

function run(src) {
  const raw = tokenize(src);
  post(raw);
  const normalized = normalizeTokens(raw);
  const ast = parse(normalized);

  let branches = [[]];

  for (const node of ast) {
    const fn = commands[node.name];

    if (!fn) {
      outlet(0,
        "Unknown command: \"" + node.name + "\"",
        "args:",
        node.args
      );
      break;
    }

    const result = fn(branches, ...node.args);
    if (result && result.branches !== undefined) {
      branches = result.branches;
    } else {
      branches = [result];
    }
  }

  return branches;
}





//

//done! - Need to build commands out enough to test
//done! - add parsing logic for input string
//done! - add a few tester clip manipulation methods
//done! - read clip dictionary
//done! - fix mapping that removes note id
//done! - this needs to handle quotes or something
//done! - probably needs fallback logic if no clip found
//done! - handle missing clip