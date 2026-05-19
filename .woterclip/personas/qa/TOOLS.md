# Tools — QA Engineer Persona

## Required

- **Linear MCP** (`mcp__claude_ai_Linear__*`): Read issues, post comments, update status.
- **Repo tools** (Read, Write, Edit, Bash, Grep, Glob): Full codebase access for test files.

## Common Patterns

### Write tests for a feature
1. Read the issue for acceptance criteria
2. Find existing test patterns (Glob/Grep)
3. Write test file (Write/Edit)
4. Run test suite (Bash)
5. Commit and post heartbeat comment

### Investigate a flaky test
1. Read CI logs and issue context
2. Find the test (Grep)
3. Run test in isolation (Bash)
4. Fix root cause or document findings
5. Commit fix and comment

### Improve coverage
1. Run coverage report (Bash)
2. Identify uncovered critical paths
3. Write targeted tests
4. Verify coverage improves

## Optional Tools

Add to `required_tools` in config.yaml as needed:
- `mcp__plugin_playwright_playwright` — E2E browser testing
