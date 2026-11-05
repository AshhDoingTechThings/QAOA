# QAOA Health Optimiser

**Hybrid Quantum-Classical Framework for Healthcare Resource Optimization using QAOA**
Team 09 · Vidya Jyothi Institute of Technology, Department of AI
Guide: Dr K Venkata Subba Reddy · Namani Yashaswini (23911A3541) · Syed Asif (23911A3559)

An end-to-end, demonstrable implementation of the Review-1 design. A configurable
healthcare allocation scenario is turned into a **QUBO** and then an **Ising
Hamiltonian**. That model is solved with **exact enumeration**, **classical
baselines** and **QAOA** (ideal and noisy), and the results are benchmarked on
quality, feasibility, runtime, stability, qubits and circuit depth. An interactive
**3D dashboard** presents each step.

```
Scenario → Mathematical model → QUBO → Ising → { Exact | Classical | QAOA (Qiskit) } → Benchmark → Dashboard
```

## Run it

```bash
./run.sh
```

Then open http://localhost:8000. On the first run, the script creates `.venv` and installs `backend/requirements.txt`.

Tests (formulation, Ising mapping, solvers, Qiskit cross-check, API):

```bash
cd backend && ../.venv/bin/python -m pytest -q
```

## Architecture

| Layer | File | What it does |
|---|---|---|
| Scenario | `backend/app/scenario.py` | Facilities (demand, capacity, cost, priority, min-service), stock, λ weights, 4 presets |
| Model → QUBO → Ising | `backend/app/qubo.py` | 2-bit register per facility, slack register for the stock inequality, exact quadratic encoding of every term, x = (1−z)/2 Ising mapping, constraint checker |
| Classical | `backend/app/solvers.py` | Exact enumeration (QUBO ground state **and** the original constrained optimum), rule-based greedy, simulated annealing |
| Quantum | `backend/app/qaoa.py` | NumPy statevector QAOA, COBYLA / Nelder-Mead / Powell, ⟨H⟩ or CVaR-α objective, INTERP / ramp / random initialisation, depolarising + read-out noise via quantum trajectories, Qiskit Statevector cross-check, Qiskit-transpiled depth and CX counts (all-to-all and linear), OpenQASM 2 export |
| Benchmark | `backend/app/benchmark.py` | Multi-seed runs under identical conditions: gap, approximation ratio, feasibility rate, P_opt, stability (std), runtime, qubits, depth, plus a scaling table |
| API | `backend/app/main.py` | FastAPI: `/api/model`, `/api/solve/{exact,greedy,sa,qaoa}`, `/api/landscape`, `/api/benchmark`. It also serves the frontend |
| Frontend | `frontend/` | Three.js 3D views (hospital network, Ising graph with Bloch spheres, p=1 energy landscape with optimiser path, bit-string skyline) and SVG charts. Three.js is vendored, so it works offline |

