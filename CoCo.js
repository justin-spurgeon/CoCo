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
	//var flattenedNotes = flatten(notes);
	var filteredNotes = notes.map(({pitch, start_time, duration, velocity}) => ({pitch, start_time, duration, velocity}));
	return {"notes": filteredNotes};
}



// --- Functional pipeline DSL ---
// Pipeline: tokens separated by ";". Each token is source (read), sink (write/overwrite), or transform (map/filter/sort + backtick fn, or shorthand e.g. p+12, v*0.8).

function tokenize(src) {
  return src
    .split(/\s*\;\s*/)
    .map(function(t) { return t.trim(); })
    .filter(Boolean);
}

// Splits a segment into parts; backtick-wrapped content stays one part (backticks stripped).
function splitArgs(segment) {
  var parts = [];
  var i = 0;
  var current = "";
  var inBackticks = false;

  while (i < segment.length) {
    var c = segment[i];

    if (inBackticks) {
      if (c === "`") {
        parts.push(current);
        current = "";
        inBackticks = false;
      } else {
        current += c;
      }
      i++;
      continue;
    }

    if (c === "`") {
      if (current.length) {
        parts.push(current.trim());
        current = "";
      }
      inBackticks = true;
      i++;
      continue;
    }

    if (/\s/.test(c)) {
      if (current.length) {
        parts.push(current.trim());
        current = "";
      }
      while (i < segment.length && /\s/.test(segment[i])) i++;
      continue;
    }

    current += c;
    i++;
  }

  if (current.length) {
    parts.push(inBackticks ? current : current.trim());
  }

  return parts;
}

function compileArrowFunction(arg) {
  if (typeof arg !== "string") return null;
  var arrowMatch = arg.match(/^\s*\(([^)]*)\)\s*=>\s*([\s\S]*)$/);
  if (!arrowMatch) return null;
  var paramList = arrowMatch[1].split(",").map(function(p) { return p.trim(); }).filter(Boolean);
  var body = arrowMatch[2].trim();
  var isExpression = !/^\s*\{/.test(body);
  var bodyCode = isExpression ? "return (" + body + ")" : body;
  return new (Function.prototype.bind.apply(Function, [null].concat(paramList, [bodyCode])));
}

// Shorthand: p|s|d|v + number (offset) or * number (scale). Returns notes=>notes map or null.
function parseShorthand(token) {
  if (typeof token !== "string" || !token.length) return null;
  var m = token.match(/^([psdv])([\*+])(-?\d*\.?\d+)$/);
  if (!m) return null;
  var field = m[1];
  var op = m[2];
  var num = parseFloat(m[3]);
  var key = field === "p" ? "pitch" : field === "s" ? "start_time" : field === "d" ? "duration" : "velocity";

  return function(notes) {
    return notes.map(function(note) {
      var val = note[key];
      var newVal = op === "+" ? val + num : val * num;
      if (key === "pitch" || key === "velocity") newVal = Math.round(Math.max(0, Math.min(127, newVal)));
      var out = {};
      for (var k in note) out[k] = note[k];
      out[key] = newVal;
      return out;
    });
  };
}

function parseNum(x) {
  var n = Number(x);
  return (n !== n) ? 0 : n;
}

// Returns { fn: function(notes)=>notes } (source fn ignores input). On error, outlet and return null.
function buildStep(segment) {
  var parts = splitArgs(segment);
  if (!parts.length) return null;

  var cmd = parts[0];

  if (cmd === "read" && parts.length >= 3) {
    var track = parseNum(parts[1]);
    var slot = parseNum(parts[2]);
    return {
      fn: function(notes) {
        return readClip([], track, slot);
      }
    };
  }

  if (cmd === "write" && parts.length >= 3) {
    var trackW = parseNum(parts[1]);
    var slotW = parseNum(parts[2]);
    return {
      fn: function(notes) {
        writeClip(notes, trackW, slotW);
        return notes;
      }
    };
  }

  if (cmd === "overwrite" && parts.length >= 3) {
    var trackO = parseNum(parts[1]);
    var slotO = parseNum(parts[2]);
    return {
      fn: function(notes) {
        overwriteClip(notes, trackO, slotO);
        return notes;
      }
    };
  }

  if (cmd === "map" && parts.length >= 2) {
    var fnMap = compileArrowFunction(parts[1]);
    if (typeof fnMap !== "function") {
      outlet(0, "map expects a function in backticks, e.g. map `(n) => ({ ...n, pitch: n.pitch + 12 })`");
      return null;
    }
    return {
      fn: function(notes) {
        return notes.map(function(note, index) { return fnMap(note, index); });
      }
    };
  }

  if (cmd === "flatMap" && parts.length >= 2) {
    var fnFlatMap = compileArrowFunction(parts[1]);
    if (typeof fnFlatMap !== "function") {
      outlet(0, "flatMap expects a function in backticks that returns an array of notes, e.g. flatMap `(n) => [...]`");
      return null;
    }
    return {
      fn: function(notes) {
        return notes.flatMap(function(note, index) {
          var out = fnFlatMap(note, index);
          return Array.isArray(out) ? out : [out];
        });
      }
    };
  }

  if (cmd === "subdivide" && parts.length >= 2) {
    var divisions = Math.max(1, Math.min(256, Math.floor(parseNum(parts[1]))));
    return {
      fn: function(notes) {
        return notes.flatMap(function(note) {
          var d = note.duration / divisions;
          return Array.from({ length: divisions }, function(_, i) {
            return {
              pitch: note.pitch,
              start_time: note.start_time + i * d,
              duration: d,
              velocity: note.velocity
            };
          });
        });
      }
    };
  }

  if (cmd === "filter" && parts.length >= 2) {
    var fnFilter = compileArrowFunction(parts[1]);
    if (typeof fnFilter !== "function") {
      outlet(0, "filter expects a function in backticks, e.g. filter `(note, i) => i % 2 === 0`");
      return null;
    }
    return {
      fn: function(notes) {
        return notes.filter(function(note, index) { return fnFilter(note, index); });
      }
    };
  }

  if (cmd === "sort" && parts.length >= 2) {
    var fnSort = compileArrowFunction(parts[1]);
    if (typeof fnSort !== "function") {
      outlet(0, "sort expects a function in backticks, e.g. sort `(a, b) => a.start_time - b.start_time`");
      return null;
    }
    return {
      fn: function(notes) {
        return notes.slice().sort(fnSort);
      }
    };
  }

  if (parts.length === 1) {
    var shorthandFn = parseShorthand(parts[0]);
    if (shorthandFn) {
      return { fn: shorthandFn };
    }
  }

  outlet(0, "Unknown or malformed segment: " + segment);
  return null;
}

function run(src) {
  var segments = tokenize(src);
  post(segments);

  var steps = [];
  for (var i = 0; i < segments.length; i++) {
    var step = buildStep(segments[i]);
    if (step === null) return;
    steps.push(step);
  }

  if (steps.length === 0) return;

  var data = steps.reduce(function(acc, step) {
    return step.fn(acc);
  }, []);

  return data;
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