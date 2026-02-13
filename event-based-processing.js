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

function addNotesInGap(queen, gap, n, refNote, clipLengthBeats) {
	if (gap.length <= 0 || n < 1) return;
	var step = gap.length / n;
	for (var j = 0; j < n; j++) {
		var pos = gap.start + j * step;
		if (gap.wrap && pos >= clipLengthBeats) pos = pos - clipLengthBeats;
		queen.push({
			pitch: refNote.pitch,
			start_time: pos,
			duration: step,
			velocity: refNote.velocity
		});
	}
}

function runRead(state, args) {
	if (args.length < 2) return;
	var track = parseNum(args[0]);
	var slot = parseNum(args[1]);
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
	if (args.length < 3 || args[1] !== "add") return;
	var i = parseNum(args[0]);
	var n = Math.max(0, Math.floor(parseNum(args[2])));
	if (n === 0) return;
	var gap = getGapAfter(state.king, i, state.clipLengthBeats);
	if (!gap) return;
	addNotesInGap(state.queen, gap, n, state.king[i], state.clipLengthBeats);
}

function runBefore(state, args) {
	if (state.king.length === 0) return;
	if (args.length < 3 || args[1] !== "add") return;
	var i = parseNum(args[0]);
	var n = Math.max(0, Math.floor(parseNum(args[2])));
	if (n === 0) return;
	var gap = getGapBefore(state.king, i, state.clipLengthBeats);
	if (!gap) return;
	addNotesInGap(state.queen, gap, n, state.king[i], state.clipLengthBeats);
}

function runAt(state, args) {
	if (state.king.length === 0) return;
	if (args.length < 3 || args[1] !== "transpose") return;
	var i = parseNum(args[0]);
	var k = parseNum(args[2]);
	if (i < 0 || i >= state.king.length) return;
	var note = state.king[i];
	state.queen.push({
		pitch: Math.max(0, Math.min(127, note.pitch + k)),
		start_time: note.start_time,
		duration: note.duration,
		velocity: note.velocity
	});
}

function runWrite(state, args) {
	if (args.length < 2) return;
	var track = parseNum(args[0]);
	var slot = parseNum(args[1]);
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
		var parts = tokens[t].split(/\s+/).filter(Boolean);
		if (parts.length === 0) continue;
		var cmd = parts[0].toLowerCase();
		var args = parts.slice(1);

		if (cmd === "read") runRead(state, args);
		else if (cmd === "after") runAfter(state, args);
		else if (cmd === "before") runBefore(state, args);
		else if (cmd === "at") runAt(state, args);
		else if (cmd === "write") runWrite(state, args);
		else outlet(0, "Unknown command: " + cmd);
	}
}

