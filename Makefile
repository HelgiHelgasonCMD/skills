.PHONY: check install showcase vscode-test

# Needs Pillow: point PYTHON_PIL at a venv python that has it.
PYTHON_PIL ?= python3

check:
	python3 tools/validate.py
	python3 tools/scan_sensitive.py
	python3 -m unittest discover -s tests -q
	node --test vscode/claude-inline/test/unit/*.test.js
	bash -n tools/install.sh .githooks/pre-commit
	@if command -v claude >/dev/null; then claude plugin validate . --strict >/dev/null && echo "plugin: valid"; fi
	@if command -v shellcheck >/dev/null; then shellcheck tools/install.sh .githooks/pre-commit; fi

install:
	tools/install.sh

showcase:
	$(PYTHON_PIL) tools/make_showcase.py docs/inline-comments Main Review Summary

# Drives a real VS Code under Xvfb; needs `npm ci` in vscode/claude-inline and python-xlib.
vscode-test:
	cd vscode/claude-inline && CLAUDE_INLINE_KEYS=$${CLAUDE_INLINE_KEYS:-python3} xvfb-run -a -s "-screen 0 1400x900x24" npm run -s test:integration
