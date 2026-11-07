// Shell completion scripts.
import { println } from "./common.ts";
import { newRunFlags } from "./runflags.ts";
import { SUBCOMMANDS } from "./usage.ts";

/** Every run flag, plus the flags of the other subcommands. */
function flagNames(): string[] {
  const seen = new Set(newRunFlags().names());
  for (const n of ["keep", "all", "diff", "sides", "format", "batch", "n", "version", "to", "older-than", "m", "running", "help"]) seen.add(n);
  return [...seen].sort();
}

export function cmdCompletion(args: string[]): void {
  const usage = new Error("usage: ferry completion bash|zsh|fish|powershell");
  if (args.length !== 1) throw usage;
  const cmds = SUBCOMMANDS.join(" ");
  const flags = flagNames().map((n) => "--" + n).join(" ");
  switch (args[0]) {
    case "bash":
      println(`# ferry bash completion — add to ~/.bashrc:  source <(ferry completion bash)
_ferry() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  if [[ $COMP_CWORD -eq 1 && $cur != -* ]]; then
    COMPREPLY=( $(compgen -W "${cmds}" -- "$cur") $(compgen -d -- "$cur") )
    return
  fi
  case "\${COMP_WORDS[1]}" in
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
    COMPREPLY=( $(compgen -W "${flags}" -- "$cur") )
  else
    COMPREPLY=( $(compgen -d -- "$cur") )
  fi
}
complete -o filenames -F _ferry ferry`);
      return;
    case "zsh":
      println(`#compdef ferry
# ferry zsh completion — add to ~/.zshrc:  source <(ferry completion zsh)
_ferry() {
  local -a cmds flags
  cmds=(${cmds})
  flags=(${flags})
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
compdef _ferry ferry`);
      return;
    case "fish": {
      const lines = ["# ferry fish completion — save as ~/.config/fish/completions/ferry.fish", "complete -c ferry -f"];
      for (const c of SUBCOMMANDS) lines.push(`complete -c ferry -n '__fish_use_subcommand' -a ${c}`);
      lines.push(
        "complete -c ferry -n '__fish_seen_subcommand_from service' -a 'install uninstall start stop status logs'",
        "complete -c ferry -n '__fish_seen_subcommand_from backups' -a 'list restore prune'",
        "complete -c ferry -n '__fish_seen_subcommand_from completion' -a 'bash zsh fish powershell'",
        "complete -c ferry -l keep -x -a 'source target newer both merge'",
      );
      for (const f of flagNames()) lines.push(`complete -c ferry -l ${f}`);
      lines.push("complete -c ferry -n 'not __fish_use_subcommand' -a '(__fish_complete_directories)'");
      println(lines.join("\n"));
      return;
    }
    case "powershell":
    case "pwsh":
      println(`# ferry PowerShell completion — add to $PROFILE:  ferry completion powershell | Out-String | Invoke-Expression
Register-ArgumentCompleter -Native -CommandName ferry -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $words = $commandAst.CommandElements | ForEach-Object { $_.ToString() }
  $cmds = '${cmds}' -split ' '
  $flags = '${flags}' -split ' '
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
}`);
      return;
  }
  throw usage;
}
