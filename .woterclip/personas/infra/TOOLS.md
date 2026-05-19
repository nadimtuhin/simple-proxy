# Tools — Infra Engineer Persona

## Required

- **Linear MCP** (`mcp__claude_ai_Linear__*`): Read issues, post comments, update status.
- **Repo tools** (Read, Write, Edit, Bash, Grep, Glob): Access CI config, Dockerfiles, deployment scripts.

## Common Patterns

### CI/CD change
1. Read the issue for requirements
2. Find relevant config files (Glob/Grep)
3. Edit pipeline config (Edit)
4. Verify locally if possible (Bash)
5. Commit and post heartbeat comment

### Environment variable / secret management
1. Read existing env config (.env.example, docs)
2. Document required vars in issue comment
3. Update .env.example or deployment config
4. Never commit actual secret values

## Optional Tools

Add to `required_tools` in config.yaml as needed:
- `mcp__vercel` — Vercel deployment management
