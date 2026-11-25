PYTHON ?= $(or $(shell command -v python3.12),python3)
VENV := .venv
RUN := $(VENV)/bin/python

.PHONY: setup pipeline dashboard

setup:
	$(PYTHON) -m venv $(VENV)
	$(RUN) -m pip install -r requirements.txt

pipeline:
	$(RUN) load_data.py
	$(RUN) analysis.py

dashboard:
	$(RUN) dashboard.py
