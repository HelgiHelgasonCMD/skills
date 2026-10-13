.PHONY: check install

check:
	python3 tools/validate.py
	python3 tools/scan_sensitive.py
	python3 -m unittest discover -s tests -q
	bash -n tools/install.sh .githooks/pre-commit
	@if command -v claude >/dev/null; then claude plugin validate . --strict >/dev/null && echo "plugin: valid"; fi
	@if command -v shellcheck >/dev/null; then shellcheck tools/install.sh .githooks/pre-commit; fi

install:
	tools/install.sh
