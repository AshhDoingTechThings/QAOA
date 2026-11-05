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


@pytest.mark.parametrize("key", PRESET_KEYS)
def test_formulation_valid_ground_state_is_feasible_optimum(key):
    ex = exact(build_model(PRESETS[key]))
    assert ex["formulation_valid"]
    assert ex["solution"]["feasible"]


def test_small_penalty_breaks_formulation():
    sc = PRESETS["ventilators"].model_copy(deep=True)
    sc.lambdas.capacity = 0.1
    sc.lambdas.min_service = 0.1
    assert not exact(build_model(sc))["formulation_valid"]


def test_feasible_mask_matches_scalar_check():
    m = build_model(PRESETS["validation"])
    fm = feasible_mask(m)
    for i in range(len(fm)):
        assert fm[i] == is_feasible(m.scenario, m.decode(i)["alloc"])


def test_classical_baselines():
    m = build_model(PRESETS["nurses"])
    ex = exact(m)
    g = greedy(m, ex["optimum"])
    sa = simulated_annealing(m, seed=0, optimum=ex["optimum"])
    assert g["solution"]["feasible"]
    assert sa["solution"]["objective"] == pytest.approx(ex["optimum"])


def test_mixer_is_unitary_and_cost_is_diagonal():
    m = build_model(PRESETS["validation"])
    sim = QAOASim(m)
    psi = sim.state(np.array([0.4, 0.7, 0.3, 0.2]), 2)
    assert np.linalg.norm(psi) == pytest.approx(1.0)


@pytest.mark.skipif(not HAVE_QISKIT, reason="qiskit not installed")
def test_simulator_matches_qiskit_statevector():
    m = build_model(PRESETS["validation"])
    chk = qiskit_crosscheck(m, np.array([0.5, 1.1, -0.3, 0.25]), 2)
    assert chk["fidelity"] == pytest.approx(1.0, abs=1e-9)


def test_qaoa_beats_uniform_sampling():
    m = build_model(PRESETS["nurses"])
    ex = exact(m)
    r = run_qaoa(m, ex["optimum"], encode_alloc(m, ex["solution"]["alloc"]), p=3, objective="cvar",
                 alpha=0.25, crosscheck=False)
    assert r["ideal"]["amplification_opt"] > 2
    assert r["ideal"]["amplification_feasible"] > 1.2


def test_api_end_to_end():
    c = TestClient(app)
    sc = c.get("/api/presets").json()["validation"]
    assert c.post("/api/model", json=sc).json()["n_qubits"] == 8
    q = c.post("/api/solve/qaoa", json={"scenario": sc, "p": 1, "noise": {"enabled": True, "trajectories": 8}}).json()
    assert "noisy" in q and q["sampled"]["shots"] == 2048
    b = c.post("/api/benchmark", json={"scenario": sc, "seeds": [0], "p_list": [1]}).json()
    assert {r["key"] for r in b["rows"]} >= {"exact", "greedy", "sa", "qaoa1", "qaoa1n"}
