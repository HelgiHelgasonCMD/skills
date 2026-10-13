.PHONY: check install showcase

# Needs Pillow: point PYTHON_PIL at a venv python that has it.
PYTHON_PIL ?= python3

check:
	python3 tools/validate.py
	python3 tools/scan_sensitive.py
	python3 -m unittest discover -s tests -q
	bash -n tools/install.sh .githooks/pre-commit
	@if command -v claude >/dev/null; then claude plugin validate . --strict >/dev/null && echo "plugin: valid"; fi
	@if command -v shellcheck >/dev/null; then shellcheck tools/install.sh .githooks/pre-commit; fi

install:
	tools/install.sh

showcase:
	$(PYTHON_PIL) tools/make_showcase.py docs/inline-comments Main Review Summary
