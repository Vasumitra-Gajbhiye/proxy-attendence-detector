# Headcount — local real-time people counter
#   make setup                     install backend venv + frontend deps
#   make dev                       run backend (camera 0) + frontend together
#   make dev SOURCE=clip.mp4       ...on a video file instead
#   make backend / make frontend   run one side
#   make test                      backend tests (downloads sample media)

SOURCE ?= 0
PORT   ?= 8000
PYTHON ?= $(shell command -v python3.12 || command -v python3.11 || command -v python3.13 || command -v python3)
# Camera indices and URLs pass through; file paths are made absolute (the backend runs from backend/).
SRC_ARG = $(if $(shell echo '$(SOURCE)' | grep -E '^[0-9]+$$|://'),$(SOURCE),$(abspath $(SOURCE)))
VENV   := backend/.venv
PY     := $(VENV)/bin/python

.PHONY: dev backend frontend setup test samples build clean

dev: setup
	@echo "▶ backend  http://localhost:$(PORT)   ▶ dashboard http://localhost:3000"
	@$(MAKE) --no-print-directory -j2 backend frontend

backend: $(VENV)/.installed
	cd backend && .venv/bin/python run.py --source "$(SRC_ARG)" --port $(PORT)

frontend: frontend/node_modules
	cd frontend && NEXT_PUBLIC_BACKEND_URL=http://localhost:$(PORT) npm run dev

setup: $(VENV)/.installed frontend/node_modules

$(VENV)/.installed: backend/requirements.txt
	test -d $(VENV) || $(PYTHON) -m venv $(VENV)
	$(PY) -m pip install --upgrade pip
	$(PY) -m pip install -r backend/requirements.txt
	touch $@

frontend/node_modules: frontend/package.json
	cd frontend && npm install
	touch $@

samples:
	backend/scripts/fetch_test_media.sh

test: $(VENV)/.installed samples
	cd backend && .venv/bin/python -m pytest -q tests

build: frontend/node_modules
	cd frontend && npx tsc --noEmit && npm run build

clean:
	rm -rf $(VENV) frontend/node_modules frontend/.next
