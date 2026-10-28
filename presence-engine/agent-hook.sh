#!/bin/sh
# Claude Code hook. Appends one short line per event and always exits 0, so it adds only a
# few milliseconds. It stores tool categories and the project folder name, never prompts,
# file paths or commands.
[ -n "$EP_AI" ] && exit 0
dir="${EP_AGENT_DIR:-$HOME/Library/Application Support/EnhancedPresence}"
payload=$(cat)
event=${payload#*'"hook_event_name":"'}; event=${event%%\"*}
now=$(date +%s)
case $event in
  UserPromptSubmit)
    project=
    case $payload in *'"cwd":"'*) project=${payload#*'"cwd":"'}; project=${project%%\"*}; project=${project##*/};; esac
    printf '%s %s\n' "$now" "$project" > "$dir/agent-task"
    : > "$dir/agent-events.log";;
  Stop|SessionEnd)
    printf '%s stop 0\n' "$now" >> "$dir/agent-events.log";;
  PostToolUse|PostToolUseFailure)
    tool=${payload#*'"tool_name":"'}; tool=${tool%%\"*}
    case $tool in
      Edit|Write|MultiEdit|NotebookEdit|apply_patch) kind=edit;;
      Read|Grep|Glob|LS) kind=read;;
      WebSearch|WebFetch) kind=research;;
      Agent|Task) kind=delegate;;
      Bash|shell|exec_command|local_shell)
        # Claude Code sends a string, Codex may send an array; match on the text after "command":.
        command=${payload#*'"command":'}; command=${command%%\}*}
        case $command in
          *'git commit'*|*'git push'*|*'git merge'*|*'git rebase'*) kind=git;;
          *test*|*pytest*|*jest*|*vitest*) kind=test;;
          *build*|*compile*|*tsc*|*swiftc*|*xcodebuild*|*make*|*lint*) kind=build;;
          *'npm i'*|*'npm add'*|*'pnpm i'*|*'pnpm add'*|*'yarn add'*|*'pip install'*|*'brew install'*) kind=install;;
          *) kind=shell;;
        esac;;
      *) kind=other;;
    esac
    failed=0; [ "$event" = PostToolUseFailure ] && failed=1
    printf '%s %s %s\n' "$now" "$kind" "$failed" >> "$dir/agent-events.log";;
esac
exit 0
