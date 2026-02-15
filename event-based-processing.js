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
	var filteredNotes = notes.map(function(n) {
		return { pitch: n.pitch, start_time: n.start_time, duration: n.duration, velocity: n.velocity };
	});
	return {"notes": filteredNotes};
}

// --- Event-based DSL (king / queen) ---
// Tokenize by " . "
function tokenize(src) {
	return src.split(/\s*\.\s*/).map(function(t) { return t.trim(); }).filter(Boolean);
}

function parseNum(x) {
	var n = Number(x);
	return (n !== n) ? 0 : n;
}

// Split one token into raw parts; respects brackets and quotes so [60, 64, 67] and "hello world" stay one part.
function splitTokenParts(token) {
	var parts = [];
	var i = 0;
	var current = "";
	var inBrackets = 0;
	var quoteChar = null;

	while (i < token.length) {
		var c = token[i];

		if (quoteChar) {
			current += c;
			if (c === quoteChar) {
				quoteChar = null;
				if (inBrackets === 0) {
					parts.push(current);
					current = "";
				}
			}
			i++;
			continue;
		}

		if (inBrackets > 0) {
			current += c;
			if (c === '"' || c === "'") {
				quoteChar = c;
			} else if (c === "]") {
				inBrackets--;
				if (inBrackets === 0) {
					parts.push(current);
					current = "";
				}
			} else if (c === "[") {
				inBrackets++;
			}
			i++;
			continue;
		}

		if (c === '"' || c === "'") {
			if (current.length) {
				parts.push(current);
				current = "";
			}
			quoteChar = c;
			current = c;
			i++;
			continue;
		}

		if (c === "[") {
			if (current.length) {
				parts.push(current);
				current = "";
			}
			inBrackets = 1;
			current = c;
			i++;
			continue;
		}

		if (/\s/.test(c)) {
			if (current.length) {
				parts.push(current);
				current = "";
			}
			while (i < token.length && /\s/.test(token[i])) i++;
			continue;
		}

		current += c;
		i++;
	}

	if (current.length) parts.push(current);
	return parts.filter(function(p) { return p.length > 0; });
}

// Parse one raw part into a value: quoted string, array, number, or string. Order: quote -> array -> number -> string.
function parseArg(raw) {
	var s = (raw && raw.trim) ? raw.trim() : String(raw);
	if (s.length >= 2 && (s.charAt(0) === '"' && s.charAt(s.length - 1) === '"' || s.charAt(0) === "'" && s.charAt(s.length - 1) === "'")) {
		return s.slice(1, s.length - 1);
	}
	if (s.length >= 2 && s.charAt(0) === "[" && s.charAt(s.length - 1) === "]") {
		try {
			return JSON.parse(s);
		} catch (e) {
			return s;
		}
	}
	if (s !== "" && !isNaN(Number(s)) && isFinite(Number(s))) {
		return Number(s);
	}
	return s;
}

// Returns { start, length, wrap } in beats, or null if invalid/empty gap.
function getGapAfter(king, i, clipLengthBeats) {
	var N = king.length;
	if (N === 0 || i < 0 || i >= N) return null;
	var gapStart = king[i].start_time + king[i].duration;
	if (i + 1 < N) {
		var end = king[i + 1].start_time;
		return { start: gapStart, length: Math.max(0, end - gapStart), wrap: false };
	}
	var totalLength = (clipLengthBeats - gapStart) + king[0].start_time;
	return { start: gapStart, length: totalLength, wrap: true };
}

function getGapBefore(king, i, clipLengthBeats) {
	var N = king.length;
	if (N === 0 || i < 0 || i >= N) return null;
	var gapEnd = king[i].start_time;
	if (i > 0) {
		var start = king[i - 1].start_time + king[i - 1].duration;
		return { start: start, length: Math.max(0, gapEnd - start), wrap: false };
	}
	var gapStart = king[N - 1].start_time + king[N - 1].duration;
	var totalLength = (clipLengthBeats - gapStart) + gapEnd;
	return { start: gapStart, length: totalLength, wrap: true };
}

// Gap op signature: (queen, gap, n, refStart, refEnd, clipLengthBeats, opArgs). add uses only refStart.
function addNotesInGap(queen, gap, n, refStart, refEnd, clipLengthBeats, opArgs) {
	if (gap.length <= 0 || n < 1) return;
	var step = gap.length / n;
	for (var j = 0; j < n; j++) {
		var pos = gap.start + j * step;
		if (gap.wrap && pos >= clipLengthBeats) pos = pos - clipLengthBeats;
		queen.push({
			pitch: refStart.pitch,
			start_time: pos,
			duration: step,
			velocity: refStart.velocity
		});
	}
}

function arpAddNotesInGap(queen, gap, n, refStart, refEnd, clipLengthBeats, opArgs) {
	if (gap.length <= 0 || n < 1) return;
	var step = gap.length / n;
	var pitchStep = n === 1 ? 0 : (refEnd.pitch - refStart.pitch) / (n - 1);
	var velStep = n === 1 ? 0 : (refEnd.velocity - refStart.velocity) / (n - 1);
	for (var j = 0; j < n; j++) {
		var pos = gap.start + j * step;
		if (gap.wrap && pos >= clipLengthBeats) pos = pos - clipLengthBeats;
		var pitch = n === 1 ? refStart.pitch : Math.round(refStart.pitch + j * pitchStep);
		var vel = n === 1 ? refStart.velocity : Math.round(refStart.velocity + j * velStep);
		queen.push({
			pitch: Math.max(0, Math.min(127, pitch)),
			start_time: pos,
			duration: step,
			velocity: Math.max(0, Math.min(127, vel))
		});
	}
}

function fillNotesInGap(queen, gap, n, refStart, refEnd, clipLengthBeats, opArgs) {
	if (gap.length <= 0) return;
	var pos = gap.start;
	if (gap.wrap && pos >= clipLengthBeats) pos = pos - clipLengthBeats;
	queen.push({
		pitch: refEnd.pitch,
		start_time: pos,
		duration: gap.length,
		velocity: refEnd.velocity
	});
}

function rollNotesInGap(queen, gap, n, refStart, refEnd, clipLengthBeats, opArgs) {
	if (gap.length <= 0 || n < 1) return;
	var decay = 0.9;
	var startTimes = [];
	if (n === 1) {
		startTimes = [gap.start];
	} else {
		var denom = 1 - Math.pow(decay, n - 1);
		for (var j = 0; j < n; j++) {
			var x = (1 - Math.pow(decay, j)) / denom;
			startTimes.push(gap.start + gap.length * x);
		}
	}
	for (var k = 0; k < n; k++) {
		var st = startTimes[k];
		var dur = k < n - 1 ? startTimes[k + 1] - st : (gap.start + gap.length) - st;
		if (gap.wrap && st >= clipLengthBeats) st = st - clipLengthBeats;
		queen.push({
			pitch: refStart.pitch,
			start_time: st,
			duration: dur,
			velocity: refStart.velocity
		});
	}
}

function spreadNotesInGap(queen, gap, n, refStart, refEnd, clipLengthBeats, opArgs) {
	if (gap.length <= 0 || n < 1) return;
	var pitchArray = opArgs && opArgs[1] && Array.isArray(opArgs[1]) ? opArgs[1] : null;
	var step = gap.length / n;
	for (var j = 0; j < n; j++) {
		var pos = gap.start + j * step;
		if (gap.wrap && pos >= clipLengthBeats) pos = pos - clipLengthBeats;
		var pitch = pitchArray ? pitchArray[j % pitchArray.length] : refStart.pitch;
		pitch = Math.max(0, Math.min(127, pitch));
		queen.push({
			pitch: pitch,
			start_time: pos,
			duration: step,
			velocity: refStart.velocity
		});
	}
}

// Registry: add new gap ops (after i op n / before i op n) here. Signature: (queen, gap, n, refStart, refEnd, clipLengthBeats, opArgs).
var gapOps = { add: addNotesInGap, arpadd: arpAddNotesInGap, fill: fillNotesInGap, roll: rollNotesInGap, spread: spreadNotesInGap };

function runRead(state, args) {
	if (args.length < 2) return;
	var track = typeof args[0] === "number" ? args[0] : parseNum(args[0]);
	var slot = typeof args[1] === "number" ? args[1] : parseNum(args[1]);
	var clip = getClip(track, slot);
	var raw = JSON.parse(clip.call("get_all_notes_extended"));
	state.king = raw.notes || [];
	state.king.sort(function(a, b) { return a.start_time - b.start_time; });
	var len = Number(clip.get("length"));
	state.clipLengthBeats = (len !== len) ? 0 : len;
	state.queen = [];
}

function runAfter(state, args) {
	if (state.king.length === 0) return;
	if (args.length < 3) return;
	var index = typeof args[0] === "number" ? args[0] : parseNum(args[0]);
	var op = String(args[1]).toLowerCase();
	var opArgs = args.slice(2);
	var fn = gapOps[op];
	if (!fn) {
		outlet(0, "Unknown op: " + op);
		return;
	}
	var gap = getGapAfter(state.king, index, state.clipLengthBeats);
	if (!gap) return;
	var N = state.king.length;
	var refStart = state.king[index];
	var refEnd = state.king[(index + 1) % N];
	var n = typeof opArgs[0] === "number" ? Math.max(0, Math.floor(opArgs[0])) : Math.max(0, Math.floor(parseNum(opArgs[0])));
	if (op === "fill") n = 1;
	if (n === 0) return;
	fn(state.queen, gap, n, refStart, refEnd, state.clipLengthBeats, opArgs);
}

function runBefore(state, args) {
	if (state.king.length === 0) return;
	if (args.length < 3) return;
	var index = typeof args[0] === "number" ? args[0] : parseNum(args[0]);
	var op = String(args[1]).toLowerCase();
	var opArgs = args.slice(2);
	var fn = gapOps[op];
	if (!fn) {
		outlet(0, "Unknown op: " + op);
		return;
	}
	var gap = getGapBefore(state.king, index, state.clipLengthBeats);
	if (!gap) return;
	var N = state.king.length;
	var refStart = state.king[(index - 1 + N) % N];
	var refEnd = state.king[index];
	var n = typeof opArgs[0] === "number" ? Math.max(0, Math.floor(opArgs[0])) : Math.max(0, Math.floor(parseNum(opArgs[0])));
	if (op === "fill") n = 1;
	if (n === 0) return;
	fn(state.queen, gap, n, refStart, refEnd, state.clipLengthBeats, opArgs);
}

function atTranspose(state, index, opArgs) {
	if (opArgs.length < 1) return;
	var k = typeof opArgs[0] === "number" ? opArgs[0] : parseNum(opArgs[0]);
	if (index < 0 || index >= state.king.length) return;
	var note = state.king[index];
	state.queen.push({
		pitch: Math.max(0, Math.min(127, note.pitch + k)),
		start_time: note.start_time,
		duration: note.duration,
		velocity: note.velocity
	});
}

function atChord(state, index, opArgs) {
	if (opArgs.length < 1 || !Array.isArray(opArgs[0])) return;
	if (index < 0 || index >= state.king.length) return;
	var note = state.king[index];
	var offsets = opArgs[0];
	for (var i = 0; i < offsets.length; i++) {
		var offset = typeof offsets[i] === "number" ? offsets[i] : parseNum(offsets[i]);
		state.queen.push({
			pitch: Math.max(0, Math.min(127, note.pitch + offset)),
			start_time: note.start_time,
			duration: note.duration,
			velocity: note.velocity
		});
	}
}

// Registry: add new at ops (at i op ...) here. Signature: (state, index, opArgs).
var atOps = { transpose: atTranspose, chord: atChord };

function runAt(state, args) {
	if (state.king.length === 0) return;
	if (args.length < 3) return;
	var index = typeof args[0] === "number" ? args[0] : parseNum(args[0]);
	var op = String(args[1]).toLowerCase();
	var opArgs = args.slice(2);
	var fn = atOps[op];
	if (!fn) {
		outlet(0, "Unknown at op: " + op);
		return;
	}
	fn(state, index, opArgs);
}

function runWrite(state, args) {
	if (args.length < 2) return;
	var track = typeof args[0] === "number" ? args[0] : parseNum(args[0]);
	var slot = typeof args[1] === "number" ? args[1] : parseNum(args[1]);
	state.queen.sort(function(a, b) {
		if (a.start_time !== b.start_time) return a.start_time - b.start_time;
		if (a.duration !== b.duration) return a.duration - b.duration;
		return a.pitch - b.pitch;
	});
	writeClip(state.queen, track, slot);
}

function run(src) {
	var state = { king: [], queen: [], clipLengthBeats: 0 };
	var tokens = tokenize(src);

	for (var t = 0; t < tokens.length; t++) {
		var rawParts = splitTokenParts(tokens[t]);
		if (rawParts.length === 0) continue;
		var parts = rawParts.map(parseArg);
		parts[0] = String(parts[0]).toLowerCase();
		var cmd = parts[0];
		var cmdAliases = { a: "after", b: "before", "@": "at" };
		cmd = cmdAliases[cmd] || cmd;
		var args = parts.slice(1);

		if (cmd === "read") runRead(state, args);
		else if (cmd === "after") runAfter(state, args);
		else if (cmd === "before") runBefore(state, args);
		else if (cmd === "at") runAt(state, args);
		else if (cmd === "write") runWrite(state, args);
		else outlet(0, "Unknown command: " + cmd);
	}
}

