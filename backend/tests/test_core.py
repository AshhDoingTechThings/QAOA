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


@pytest.mark.parametrize("key", PRESET_KEYS)
def test_qubo_energy_equals_objective_on_feasible_encodings(key):
    m = build_model(PRESETS[key])
    import itertools
    for alloc in itertools.product(range(4), repeat=m.n_fac):
        if not is_feasible(m.scenario, alloc):
            continue
        idx = encode_alloc(m, alloc)
        assert m.energies[idx] == pytest.approx(objective_of_alloc(m.scenario, alloc)["objective"], abs=1e-9)


@pytest.mark.parametrize("key", PRESET_KEYS)
def test_ising_matches_qubo(key):
    m = build_model(PRESETS[key])
    z = 1 - 2 * m.bits.astype(float)
    e_ising = z @ m.h + np.einsum("si,ij,sj->s", z, m.J, z) + m.offset
    assert np.allclose(e_ising, m.energies)


