"""Correctness tests for the formulation, the solvers and the QAOA engine.

Run:  cd backend && ../.venv/bin/python -m pytest -q
"""
import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.qaoa import HAVE_QISKIT, QAOASim, qiskit_crosscheck, run_qaoa
from app.qubo import build_model, feasible_mask, is_feasible, objective_of_alloc
from app.scenario import PRESETS
from app.solvers import encode_alloc, exact, greedy, simulated_annealing

PRESET_KEYS = list(PRESETS)


