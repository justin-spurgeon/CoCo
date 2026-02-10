function msg_string(s)
{
	//post(s);
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
	
	//post(path2);
	return clip;
}

// Returns the clip at the selected track and clip slot
// TODO - probably needs fallback logic if no clip found
function readClip(notes, track, clipSlot) {
	var clip = getClip(track, clipSlot);
	
	var clipNotes = JSON.parse(clip.call("get_all_notes_extended"));
	
	return clipNotes.notes;
}

// TODO - handle missing clip
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
	//var flattenedNotes = flatten(notes);
	var filteredNotes = notes.map(({pitch, start_time, duration, velocity}) => ({pitch, start_time, duration, velocity}));
	return {"notes": filteredNotes};
}



const commands = {
	// i/o methods
	read: (i, track, clipSlot) => readClip(i, track, clipSlot),
	write: (i, track, clipSlot) => writeClip(i, track, clipSlot), 
	overwrite: (i, track, clipSlot) => overwriteClip(i, track, clipSlot),
	
	// scaling methods (multiplication)
	scalePitch: (i, scaleFactor) => i.map(({pitch, start_time, duration, velocity}) => ({pitch: pitch*scaleFactor, start_time, duration, velocity})),
	scaleStart: (i, scaleFactor) => i.map(({pitch, start_time, duration, velocity}) => ({pitch, start_time: start_time*scaleFactor, duration, velocity})),
	scaleDuration: (i, scaleFactor) => i.map(({pitch, start_time, duration, velocity}) => ({pitch, start_time, duration: duration*scaleFactor, velocity})),
	scaleVelocity: (i, scaleFactor) => i.map(({pitch, start_time, duration, velocity}) => ({pitch, start_time, duration, velocity: velocity*scaleFactor})),
	
	// offset methods (addition)
	offsetPitch: (i, amount) => i.map(({pitch, start_time, duration, velocity}) => ({pitch: pitch+amount, start_time, duration, velocity})),
	offsetStart: (i, amount) => i.map(({pitch, start_time, duration, velocity}) => ({pitch, start_time: start_time+amount, duration, velocity})),
	offsetDuration: (i, amount) => i.map(({pitch, start_time, duration, velocity}) => ({pitch, start_time, duration: duration+amount, velocity})),
	offsetVelocity: (i, amount) => i.map(({pitch, start_time, duration, velocity}) => ({pitch, start_time, duration, velocity: velocity+amount})),
			
	
	// splitting methods
	subdividePattern: (i, pattern) => subdivideWithPattern(i, pattern),
	
	// joining methods
	
	// generator methods
	
	// TODOs
	clear: (i, track, clipSlot) => i,
	flatten: (i) => i,
	subdivide: (i, divisions) => i,
	invert: (i) => i

}

function subdivideWithPattern(notes, pattern) {
  //post("\n\npatta " + pattern);
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

function tokenize(src) {
  return src
    .split(/\s*\;\s*/)
    .map(t => t.trim())
    .filter(Boolean);
}

function parseArg(arg) {
  // Array or object
  if (arg.startsWith("[") || arg.startsWith("{")) {
    return JSON.parse(arg);
  }

  // Number
  const num = Number(arg);
  if (!Number.isNaN(num)) {
    return num;
  }

  // Fallback: string
  return arg;
}

function splitArgsPreservingBrackets(str) {
  const parts = [];
  let current = "";
  let depth = 0;

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (ch === "[" || ch === "{") depth++;
    if (ch === "]" || ch === "}") depth--;

    if (ch === " " && depth === 0) {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }

  if (current) parts.push(current);
  return parts;
}



function parse(tokens) {
  return tokens.map(t => {
    const parts = t.split(/\s+/);

    return {
      name: parts[0],
      args: parts.slice(1).map(parseArg)
    };
  });
}

function run(src) {
  const raw = tokenize(src);
  post(raw);
  const normalized = normalizeTokens(raw);
  const ast = parse(normalized);


  let data = [];

  for (const node of ast) {
    const fn = commands[node.name];

    if (!fn) {
      outlet(0, 
        `Unknown command: "${node.name}"`,
        "args:",
        node.args
      );
      break;
    }

    data = fn(data, ...node.args);
  }

  return data;
}





//

//done! - Need to build commands out enough to test
//done! - add parsing logic for input string
//done! - add a few tester clip manipulation methods
//done! - read clip dictionary
//done! - fix mapping that removes note id
//done! - this needs to handle quotes or something