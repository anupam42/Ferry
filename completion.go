package main

import (
	"errors"
	"flag"
	"fmt"
	"sort"
	"strings"
)

// cmdCompletion prints a shell completion script.
func cmdCompletion(args []string) error {
	if len(args) != 1 {
		return errors.New("usage: ferry completion bash|zsh|fish|powershell")
	}
	cmds := strings.Join(subcommands, " ")
	flags := runFlagNames()
	switch args[0] {
	case "bash":
		fmt.Printf(`# ferry bash completion — add to ~/.bashrc:  source <(ferry completion bash)
_ferry() {
  local cur prev
  cur="${COMP_WORDS[COMP_CWORD]}"
  prev="${COMP_WORDS[COMP_CWORD-1]}"
  if [[ $COMP_CWORD -eq 1 && $cur != -* ]]; then
    COMPREPLY=( $(compgen -W "%s" -- "$cur") $(compgen -d -- "$cur") )
    return
  fi
  case "${COMP_WORDS[1]}" in
    service) COMPREPLY=( $(compgen -W "install uninstall start stop status logs" -- "$cur") ); return ;;
    backups) [[ $COMP_CWORD -eq 2 ]] && { COMPREPLY=( $(compgen -W "list restore prune" -- "$cur") ); return; } ;;
    completion) COMPREPLY=( $(compgen -W "bash zsh fish powershell" -- "$cur") ); return ;;
  esac
  case "$prev" in
    --keep) COMPREPLY=( $(compgen -W "source target newer both merge" -- "$cur") ); return ;;
    --mode) COMPREPLY=( $(compgen -W "one-way two-way" -- "$cur") ); return ;;
    --on-delete) COMPREPLY=( $(compgen -W "keep restore propagate" -- "$cur") ); return ;;
    --conflict|--headless-conflict) COMPREPLY=( $(compgen -W "ask hold source target newer keep-both" -- "$cur") ); return ;;
    --secrets) COMPREPLY=( $(compgen -W "warn block off" -- "$cur") ); return ;;
    --eol) COMPREPLY=( $(compgen -W "keep lf crlf" -- "$cur") ); return ;;
    --symlinks) COMPREPLY=( $(compgen -W "skip follow link" -- "$cur") ); return ;;
    --ui) COMPREPLY=( $(compgen -W "auto tui plain json" -- "$cur") ); return ;;
    --theme) COMPREPLY=( $(compgen -W "auto dark light mono" -- "$cur") ); return ;;
    --format) COMPREPLY=( $(compgen -W "text markdown json" -- "$cur") ); return ;;
    --config|--log) COMPREPLY=( $(compgen -f -- "$cur") ); return ;;
  esac
  if [[ $cur == -* ]]; then
    COMPREPLY=( $(compgen -W "%s" -- "$cur") )
  else
    COMPREPLY=( $(compgen -d -- "$cur") )
  fi
}
complete -o filenames -F _ferry ferry
`, cmds, prefixed(flags, "--"))
	case "zsh":
		fmt.Printf(`#compdef ferry
# ferry zsh completion — add to ~/.zshrc:  source <(ferry completion zsh)
_ferry() {
  local -a cmds flags
  cmds=(%s)
  flags=(%s)
  if (( CURRENT == 2 )) && [[ $words[2] != -* ]]; then
    _describe 'command' cmds
    _files -/
    return
  fi
  case $words[2] in
    service) _values 'action' install uninstall start stop status logs; return ;;
    completion) _values 'shell' bash zsh fish powershell; return ;;
  esac
  case $words[CURRENT-1] in
    --keep) _values 'choice' source target newer both merge; return ;;
    --secrets) _values 'mode' warn block off; return ;;
    --eol) _values 'eol' keep lf crlf; return ;;
    --theme) _values 'theme' auto dark light mono; return ;;
    --config|--log) _files; return ;;
  esac
  if [[ $PREFIX == -* ]]; then
    compadd -- $flags
  else
    _files -/
  fi
}
compdef _ferry ferry
`, cmds, prefixed(flags, "--"))
	case "fish":
		var b strings.Builder
		b.WriteString("# ferry fish completion — save as ~/.config/fish/completions/ferry.fish\n")
		b.WriteString("complete -c ferry -f\n")
		for _, c := range subcommands {
			fmt.Fprintf(&b, "complete -c ferry -n '__fish_use_subcommand' -a %s\n", c)
		}
		b.WriteString("complete -c ferry -n '__fish_seen_subcommand_from service' -a 'install uninstall start stop status logs'\n")
		b.WriteString("complete -c ferry -n '__fish_seen_subcommand_from backups' -a 'list restore prune'\n")
		b.WriteString("complete -c ferry -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish powershell'\n")
		b.WriteString("complete -c ferry -l keep -x -a 'source target newer both merge'\n")
		for _, f := range flags {
			fmt.Fprintf(&b, "complete -c ferry -l %s\n", f)
		}
		b.WriteString("complete -c ferry -n 'not __fish_use_subcommand' -a '(__fish_complete_directories)'\n")
		fmt.Print(b.String())
	case "powershell", "pwsh":
		fmt.Printf(`# ferry PowerShell completion — add to $PROFILE:  ferry completion powershell | Out-String | Invoke-Expression
Register-ArgumentCompleter -Native -CommandName ferry -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $words = $commandAst.CommandElements | ForEach-Object { $_.ToString() }
  $cmds = '%s' -split ' '
  $flags = '%s' -split ' '
  if ($words.Count -le 2 -and -not $wordToComplete.StartsWith('-')) {
    $list = $cmds
  } elseif ($words.Count -ge 2 -and $words[1] -eq 'service') {
    $list = 'install','uninstall','start','stop','status','logs'
  } elseif ($words.Count -ge 2 -and $words[1] -eq 'completion') {
    $list = 'bash','zsh','fish','powershell'
  } elseif ($words[-2] -eq '--keep') {
    $list = 'source','target','newer','both','merge'
  } else {
    $list = $flags
  }
  $list | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
  }
}
`, cmds, prefixed(flags, "--"))
	default:
		return errors.New("usage: ferry completion bash|zsh|fish|powershell")
	}
	return nil
}

// runFlagNames lists every run flag, plus flags of the other subcommands.
func runFlagNames() []string {
	seen := map[string]bool{}
	f := newRunFlags()
	f.fs.VisitAll(func(fl *flag.Flag) { seen[fl.Name] = true })
	for _, n := range []string{"keep", "all", "diff", "sides", "format", "batch", "n", "version", "to",
		"older-than", "m", "running", "help"} {
		seen[n] = true
	}
	out := make([]string, 0, len(seen))
	for n := range seen {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}

func prefixed(names []string, p string) string {
	out := make([]string, len(names))
	for i, n := range names {
		out[i] = p + n
	}
	return strings.Join(out, " ")
}
