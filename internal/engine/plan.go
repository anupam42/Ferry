package engine

// Change is one planned file operation, reported by Plan.
type Change struct {
	Kind Kind   `json:"kind"` // add | update | delete | rename | conflict | kept
	Path string `json:"path"`
	To   string `json:"to,omitempty"`
	Dir  string `json:"direction,omitempty"` // → to target, ← to source, ⇄ both
	Note string `json:"note,omitempty"`
}

// Plan works out what a sync pass would do right now, without writing
// anything. In two-way mode it uses the pair's saved state.
func (e *Engine) Plan() ([]Change, error) {
	m := e.buildMatcher()
	S, err := scanDir(e.cfg.Source, m, e.cfg.UseGitignore, e.only, e.cfg.Symlinks)
	if err != nil {
		return nil, err
	}
	var ops []op
	if e.twoWay {
		e.loadState()
		T, err := scanDir(e.cfg.Target, m, e.cfg.UseGitignore, e.only, e.cfg.Symlinks)
		if err != nil {
			return nil, err
		}
		ops = e.planTwoWay(S, T)
	} else {
		ops = e.planOneWay(S)
	}
	ops = e.detectRenames(ops)

	var out []Change
	for _, c := range sortedKeys(e.conflicts) {
		out = append(out, Change{Kind: KConflict, Path: c, Note: "held from an earlier run"})
	}
	for _, o := range ops {
		switch o.kind {
		case opCopy:
			k := KUpdate
			if o.isNew {
				k = KAdd
			}
			out = append(out, Change{Kind: k, Path: o.rel, Dir: o.side.arrow()})
		case opDelete:
			out = append(out, Change{Kind: KDelete, Path: o.rel, Dir: o.side.arrow()})
		case opRename:
			out = append(out, Change{Kind: KRename, Path: o.rel, To: o.to, Dir: o.side.arrow()})
		case opConflict:
			out = append(out, Change{Kind: KConflict, Path: o.rel, Note: "changed on both sides"})
		case opOrphan:
			out = append(out, Change{Kind: KKept, Path: o.rel, Note: "deleted in " + o.side.other().String() + "; kept in " + o.side.String()})
		case opMerge:
			note := "three-way merge"
			if o.markers > 0 {
				note += " with conflict markers"
			}
			out = append(out, Change{Kind: KUpdate, Path: o.rel, Dir: "⇄", Note: note})
		case opDup:
			out = append(out, Change{Kind: KAdd, Path: o.to, Dir: o.side.arrow(), Note: "copy of " + o.rel})
		case opChmod:
			out = append(out, Change{Kind: KUpdate, Path: o.rel, Dir: o.side.arrow(), Note: "permissions only"})
		}
	}
	return out, nil
}
